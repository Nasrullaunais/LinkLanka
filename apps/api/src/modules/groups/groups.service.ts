import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Not, Repository } from 'typeorm';

import { ChatGroup } from '../chat/entities/chat-group.entity';
import {
  GroupMember,
  GroupMemberRole,
} from '../chat/entities/group-member.entity';
import { Message } from '../chat/entities/message.entity';
import { User } from '../../core/identity/entities/user.entity';

// ── Shared interfaces ────────────────────────────────────────────────────────

export interface OtherUser {
  id: string;
  displayName: string;
  nativeDialect: string;
  profilePictureUrl: string | null;
}

export interface GroupWithMeta extends ChatGroup {
  memberCount: number;
  lastMessageAt: Date | null;
  /** The current user's per-conversation language preference (null = use nativeDialect). */
  preferredLanguage: string | null;
  /** Populated for DMs (isGroup = false). */
  otherUser: OtherUser | null;
}

export interface UpdateProfileDto {
  displayName?: string;
  nativeDialect?: string;
  profilePictureUrl?: string;
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(ChatGroup)
    private readonly chatGroupRepo: Repository<ChatGroup>,

    @InjectRepository(GroupMember)
    private readonly groupMemberRepo: Repository<GroupMember>,

    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ── Groups ────────────────────────────────────────────────────────────────

  async findGroupsForUser(currentUserId: string): Promise<GroupWithMeta[]> {
    const memberships = await this.groupMemberRepo.find({
      where: { userId: currentUserId },
    });
    if (memberships.length === 0) return [];

    const groupIds = memberships.map((m) => m.groupId);
    const groups = await this.chatGroupRepo.find({
      where: { id: In(groupIds) },
    });

    // Build a map of groupId -> membership for O(1) preferred-language lookup
    const membershipMap = new Map(memberships.map((m) => [m.groupId, m]));

    const result: GroupWithMeta[] = await Promise.all(
      groups.map(async (g) => {
        const membership = membershipMap.get(g.id)!;

        const [memberCount, lastMessage] = await Promise.all([
          this.groupMemberRepo.count({ where: { groupId: g.id } }),
          this.messageRepo.findOne({
            where: { groupId: g.id },
            order: { createdAt: 'DESC' },
            select: ['id', 'createdAt'],
            loadEagerRelations: false,
          }),
        ]);

        // For DMs resolve the other participant so the client shows their name/avatar.
        let otherUser: OtherUser | null = null;
        if (!g.isGroup) {
          const otherMember = await this.groupMemberRepo.findOne({
            where: { groupId: g.id, userId: Not(currentUserId) },
          });
          if (otherMember) {
            const peer = await this.userRepo.findOne({
              where: { id: otherMember.userId },
              select: ['id', 'displayName', 'nativeDialect', 'profilePictureUrl'],
            });
            if (peer) {
              otherUser = {
                id: peer.id,
                displayName: peer.displayName,
                nativeDialect: peer.nativeDialect,
                profilePictureUrl: peer.profilePictureUrl,
              };
            }
          }
        }

        return {
          ...g,
          memberCount,
          lastMessageAt: lastMessage?.createdAt ?? null,
          preferredLanguage: membership.preferredLanguage,
          otherUser,
        };
      }),
    );

    // Most recently active first; conversations with no messages go to the bottom.
    result.sort((a, b) => {
      if (!a.lastMessageAt && !b.lastMessageAt) return 0;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    });

    return result;
  }

  /** Create a named group chat (private, invite-only). */
  async createGroup(
    creatorId: string,
    name: string,
    memberIds: string[],
  ): Promise<ChatGroup> {
    const group = await this.chatGroupRepo.save(
      this.chatGroupRepo.create({ name, isGroup: true }),
    );

    await this.groupMemberRepo.save(
      this.groupMemberRepo.create({
        groupId: group.id,
        userId: creatorId,
        role: GroupMemberRole.ADMIN,
      }),
    );

    const uniqueMembers = [...new Set(memberIds)].filter((id) => id !== creatorId);
    for (const memberId of uniqueMembers) {
      await this.groupMemberRepo.save(
        this.groupMemberRepo.create({
          groupId: group.id,
          userId: memberId,
          role: GroupMemberRole.MEMBER,
        }),
      );
    }

    return group;
  }

  /**
   * Find an existing DM between two users or create a new one.
   * Guarantees at most one DM conversation between any two users.
   */
  async findOrCreateDm(
    requesterId: string,
    targetUserId: string,
  ): Promise<ChatGroup> {
    if (requesterId === targetUserId) {
      throw new ConflictException('Cannot create a DM with yourself');
    }

    // Find DMs (isGroup = false) the requester is already in, then check
    // if the target is also a member of any of them.
    const requesterMemberships = await this.groupMemberRepo.find({
      where: { userId: requesterId },
    });

    for (const membership of requesterMemberships) {
      const group = await this.chatGroupRepo.findOne({
        where: { id: membership.groupId, isGroup: false },
      });
      if (!group) continue;

      const targetMembership = await this.groupMemberRepo.findOne({
        where: { groupId: group.id, userId: targetUserId },
      });
      if (targetMembership) return group; // existing DM found
    }

    // No existing DM — create one.
    const dm = await this.chatGroupRepo.save(
      this.chatGroupRepo.create({ name: null, isGroup: false }),
    );

    await this.groupMemberRepo.save([
      this.groupMemberRepo.create({
        groupId: dm.id,
        userId: requesterId,
        role: GroupMemberRole.MEMBER,
      }),
      this.groupMemberRepo.create({
        groupId: dm.id,
        userId: targetUserId,
        role: GroupMemberRole.MEMBER,
      }),
    ]);

    return dm;
  }

  async findMembers(
    groupId: string,
  ): Promise<Array<GroupMember & { user: Partial<User> | null }>> {
    const members = await this.groupMemberRepo.find({ where: { groupId } });

    return Promise.all(
      members.map(async (m) => {
        const user = await this.userRepo.findOne({
          where: { id: m.userId },
          select: ['id', 'displayName', 'nativeDialect', 'profilePictureUrl', 'expoPushToken'],
        });
        return { ...m, user } as GroupMember & { user: Partial<User> | null };
      }),
    );
  }

  async addMember(
    groupId: string,
    requesterId: string,
    newMemberId: string,
  ): Promise<GroupMember> {
    const group = await this.chatGroupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    await this.assertAdmin(groupId, requesterId);

    const existing = await this.groupMemberRepo.findOne({
      where: { groupId, userId: newMemberId },
    });
    if (existing) return existing;

    return this.groupMemberRepo.save(
      this.groupMemberRepo.create({
        groupId,
        userId: newMemberId,
        role: GroupMemberRole.MEMBER,
      }),
    );
  }

  async removeMember(
    groupId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    // Users may remove themselves; only admins may remove others.
    if (requesterId !== targetUserId) {
      await this.assertAdmin(groupId, requesterId);
    }
    await this.groupMemberRepo.delete({ groupId, userId: targetUserId });
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const member = await this.groupMemberRepo.findOne({
      where: { groupId, userId },
    });
    return !!member;
  }

  /** Set or clear the per-conversation language preference for the calling user. */
  async setLanguagePreference(
    groupId: string,
    userId: string,
    language: string | null,
  ): Promise<void> {
    const membership = await this.groupMemberRepo.findOne({
      where: { groupId, userId },
    });
    if (!membership) throw new NotFoundException('You are not a member of this group');

    membership.preferredLanguage = language;
    await this.groupMemberRepo.save(membership);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async getUserById(userId: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'displayName', 'nativeDialect', 'email', 'createdAt', 'profilePictureUrl', 'expoPushToken'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUserProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.displayName !== undefined) user.displayName = dto.displayName;
    if (dto.nativeDialect !== undefined) user.nativeDialect = dto.nativeDialect;
    if (dto.profilePictureUrl !== undefined) user.profilePictureUrl = dto.profilePictureUrl;

    await this.userRepo.save(user);
    return this.getUserById(userId);
  }

  async searchUsers(
    currentUserId: string,
    search: string,
    limit = 20,
  ): Promise<Partial<User>[]> {
    const query = search?.trim() ?? '';

    const users = await this.userRepo.find({
      where: query ? { displayName: ILike(`%${query}%`) } : {},
      select: ['id', 'displayName', 'nativeDialect', 'profilePictureUrl'],
      take: limit,
      order: { displayName: 'ASC' },
    });

    return users.filter((u) => u.id !== currentUserId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async assertAdmin(groupId: string, userId: string): Promise<void> {
    const membership = await this.groupMemberRepo.findOne({
      where: { groupId, userId },
    });
    if (!membership || membership.role !== GroupMemberRole.ADMIN) {
      throw new ForbiddenException('Only group admins can perform this action');
    }
  }
}

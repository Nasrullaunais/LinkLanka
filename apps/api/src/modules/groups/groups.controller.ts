import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { GroupsService } from './groups.service';
import { NotificationService } from '../notification/notification.service';

interface AuthRequest {
  user: { sub: string; email: string };
}

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly notificationService: NotificationService,
  ) {}

  @Get()
  findGroups(@Request() req: AuthRequest) {
    return this.groupsService.findGroupsForUser(req.user.sub);
  }

  @Post()
  createGroup(
    @Request() req: AuthRequest,
    @Body() body: { name: string; memberIds?: string[] },
  ) {
    return this.groupsService.createGroup(
      req.user.sub,
      body.name,
      body.memberIds ?? [],
    );
  }

  /** Create or retrieve a DM conversation with another user. */
  @Post('dm')
  findOrCreateDm(
    @Request() req: AuthRequest,
    @Body() body: { targetUserId: string },
  ) {
    return this.groupsService.findOrCreateDm(req.user.sub, body.targetUserId);
  }

  @Get(':id/members')
  async findMembers(@Param('id') groupId: string, @Request() req: AuthRequest) {
    const isMember = await this.groupsService.isMember(groupId, req.user.sub);
    if (!isMember)
      throw new ForbiddenException('You are not a member of this group');

    return this.groupsService.findMembers(groupId);
  }

  @Post(':id/members')
  async addMember(
    @Request() req: AuthRequest,
    @Param('id') groupId: string,
    @Body() body: { userId: string },
  ) {
    const member = await this.groupsService.addMember(
      groupId,
      req.user.sub,
      body.userId,
    );

    // Send a "You were added to {groupName}" push notification (non-blocking)
    this.sendGroupInviteNotification(groupId, body.userId).catch(() => {});

    return member;
  }

  /**
   * Sends a push notification to a user who was just added to a group.
   */
  private async sendGroupInviteNotification(
    groupId: string,
    newMemberId: string,
  ): Promise<void> {
    try {
      const [token, groups] = await Promise.all([
        this.groupsService.getExpoPushToken(newMemberId),
        this.groupsService.findGroupsForUser(newMemberId),
      ]);
      if (!token) return;

      const group = groups.find((g) => g.id === groupId);
      const groupName = group?.name ?? 'a group';

      await this.notificationService.sendPushNotifications(
        [token],
        'LinkLanka',
        `You were added to ${groupName}`,
        { groupId, groupName, type: 'group_invite' },
      );
    } catch {
      // Never throw from notification side-effect
    }
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Request() req: AuthRequest,
    @Param('id') groupId: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.groupsService.removeMember(groupId, req.user.sub, targetUserId);
  }

  /** Update group details (name). Any member may call this. */
  @Patch(':id')
  async updateGroup(
    @Request() req: AuthRequest,
    @Param('id') groupId: string,
    @Body() body: { name?: string },
  ) {
    return this.groupsService.updateGroup(groupId, req.user.sub, body);
  }

  /** Set per-conversation language preference. Pass null to reset to global default. */
  @Patch(':id/language')
  async setLanguage(
    @Request() req: AuthRequest,
    @Param('id') groupId: string,
    @Body() body: { language: string | null },
  ) {
    await this.groupsService.setLanguagePreference(
      groupId,
      req.user.sub,
      body.language,
    );
    return { ok: true };
  }
}

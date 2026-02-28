import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatGroup } from './chat-group.entity';
import { User } from '../../../core/identity/entities/user.entity';

export enum GroupMemberRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

@Entity('group_members')
export class GroupMember {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId!: string;

  @ManyToOne(() => ChatGroup, (g) => g.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: ChatGroup;

  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: GroupMemberRole,
    name: 'role',
    nullable: false,
  })
  role!: GroupMemberRole;

  /**
   * Per-conversation language preference.
   * When null, falls back to the user's nativeDialect.
   */
  @Column({ type: 'varchar', name: 'preferred_language', nullable: true, default: null })
  preferredLanguage!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'joined_at' })
  joinedAt!: Date;
}

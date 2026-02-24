import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId!: string;

  @Column({
    type: 'enum',
    enum: GroupMemberRole,
    name: 'role',
    nullable: false,
  })
  role!: GroupMemberRole;

  @CreateDateColumn({ type: 'timestamptz', name: 'joined_at' })
  joinedAt!: Date;
}

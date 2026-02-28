import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GroupMember } from './group-member.entity';
import { Message } from './message.entity';

@Entity('chat_groups')
export class ChatGroup {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** Human-readable name. Null for DMs (isGroup = false). */
  @Column({ type: 'varchar', name: 'name', nullable: true })
  name!: string | null;

  /** true = group chat, false = 1-to-1 DM */
  @Column({ type: 'boolean', name: 'is_group', default: true })
  isGroup!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => GroupMember, (m) => m.group, { cascade: ['remove'] })
  members!: GroupMember[];

  @OneToMany(() => Message, (m) => m.group, { cascade: ['remove'] })
  messages!: Message[];
}

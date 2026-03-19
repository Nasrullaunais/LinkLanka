import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { User } from '../../../core/identity/entities/user.entity';
import { Message } from './message.entity';

@Entity('message_hidden_by_users')
@Unique('uq_message_hidden_by_user', ['message', 'user'])
export class MessageHiddenByUser {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @ManyToOne(() => Message, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  @Index('idx_message_hidden_message_id')
  message!: Message;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @Index('idx_message_hidden_user_id')
  user!: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'hidden_at' })
  hiddenAt!: Date;
}

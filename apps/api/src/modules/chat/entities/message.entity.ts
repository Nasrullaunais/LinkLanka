import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../../core/identity/entities/user.entity';
export enum MessageContentType {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  // The restored relationship
  @ManyToOne(() => User, (user) => user.messages, {
    nullable: false,
    eager: true,
  })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ type: 'uuid', name: 'group_id', nullable: true })
  groupId!: string | null;

  @Column({
    type: 'enum',
    enum: MessageContentType,
    name: 'content_type',
    nullable: false,
  })
  contentType!: MessageContentType;

  @Column({ type: 'text', name: 'raw_content', nullable: false })
  rawContent!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

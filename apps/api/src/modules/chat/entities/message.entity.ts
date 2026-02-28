import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../../core/identity/entities/user.entity';
import { ChatGroup } from './chat-group.entity';
import {
  Translations,
  ExtractedAction,
} from '../../translation/translation.service';

export enum MessageContentType {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  IMAGE = 'IMAGE',
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

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId!: string;

  @ManyToOne(() => ChatGroup, (g) => g.messages, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'group_id' })
  group!: ChatGroup;

  @Column({
    type: 'enum',
    enum: MessageContentType,
    name: 'content_type',
    nullable: false,
  })
  contentType!: MessageContentType;

  @Column({ type: 'text', name: 'raw_content', nullable: false })
  rawContent!: string;

  @Column({ type: 'text', nullable: true })
  transcription: string;

  @Column({ type: 'jsonb', nullable: true })
  translations: Translations | null;

  @Column({ type: 'smallint', name: 'confidence_score', nullable: true })
  confidenceScore: number | null;

  /** Cached AI summary (3 bullet points with page refs). Populated on first
   *  GET /document-ai/:messageId/summary request. Only relevant for DOCUMENT messages. */
  @Column({ type: 'jsonb', nullable: true })
  summary: { text: string; page: number | null }[] | null;

  @Column({ type: 'boolean', name: 'is_edited', default: false, nullable: false })
  isEdited: boolean;

  /** AI-extracted actionable items (meetings, reminders) from the message content. */
  @Column({ type: 'jsonb', name: 'extracted_actions', nullable: true })
  extractedActions: ExtractedAction[] | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

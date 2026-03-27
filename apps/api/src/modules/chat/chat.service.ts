import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';

import { Message, MessageContentType } from './entities/message.entity';
import { MessageHiddenByUser } from './entities/message-hidden-by-user.entity';
import {
  Translations,
  ExtractedAction,
  DetectedLanguage,
  TranslatedAudioUrls,
} from '../translation/translation.service';

export interface SearchResult {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  contentType: MessageContentType;
  rawContent: string;
  transcription: string | null;
  headline: string;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(MessageHiddenByUser)
    private readonly hiddenMessageRepository: Repository<MessageHiddenByUser>,
  ) {}

  private applyVisibilityFilter(
    qb: SelectQueryBuilder<Message>,
    userId: string,
  ): SelectQueryBuilder<Message> {
    return qb
      .leftJoin(
        MessageHiddenByUser,
        'mh',
        'mh.message_id = m.id AND mh.user_id = :viewerId',
        { viewerId: userId },
      )
      .andWhere('mh.id IS NULL');
  }

  async saveMessage(
    userId: string,
    groupId: string,
    contentType: MessageContentType,
    rawContent: string,
    transcription: string | null = null,
    translations: Translations | null = null,
    confidenceScore: number | null = null,
    extractedActions: ExtractedAction[] | null = null,
  ): Promise<Message> {
    const message: Message = this.messageRepository.create({
      sender: { id: userId },
      groupId,
      contentType,
      rawContent,
      ...(transcription !== null && { transcription }),
      ...(translations !== null && { translations }),
      ...(confidenceScore !== null && { confidenceScore }),
      ...(extractedActions &&
        extractedActions.length > 0 && { extractedActions }),
    });

    return this.messageRepository.save(message);
  }

  async getPaginatedHistory(
    groupId: string,
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<Message[]> {
    const skip = (page - 1) * limit;

    const qb = this.messageRepository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.sender', 'sender')
      .where('m.group_id = :groupId', { groupId })
      .orderBy('m.created_at', 'DESC')
      .offset(skip)
      .limit(limit);

    this.applyVisibilityFilter(qb, userId);
    return qb.getMany();
  }

  /**
   * Returns ALL messages for a group in chronological (ASC) order.
   * Used by the mobile client to eagerly load the full chat history.
   */
  async getAllMessages(groupId: string, userId: string): Promise<Message[]> {
    const qb = this.messageRepository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.sender', 'sender')
      .where('m.group_id = :groupId', { groupId })
      .orderBy('m.created_at', 'ASC');

    this.applyVisibilityFilter(qb, userId);
    return qb.getMany();
  }

  /**
   * Cursor-based pagination — returns `limit` messages older than the given
   * cursor (ISO date string). More efficient than page-based for infinite
   * scroll because it avoids OFFSET scans on large tables.
   */
  async getCursorHistory(
    groupId: string,
    userId: string,
    before: string,
    limit: number = 30,
  ): Promise<Message[]> {
    const qb = this.messageRepository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.sender', 'sender')
      .where('m.group_id = :groupId', { groupId })
      .andWhere('m.created_at < :before', { before: new Date(before) })
      .orderBy('m.created_at', 'DESC')
      .limit(limit);

    this.applyVisibilityFilter(qb, userId);
    return qb.getMany();
  }

  async findMessageById(id: string): Promise<Message | null> {
    return this.messageRepository.findOne({
      where: { id },
      relations: ['sender'],
    });
  }

  async updateMessageTranslations(
    id: string,
    translations: Translations,
    confidenceScore: number,
  ): Promise<Message> {
    await this.messageRepository.update(id, { translations, confidenceScore });
    return this.messageRepository.findOneOrFail({
      where: { id },
      relations: ['sender'],
    });
  }

  /**
   * Phase-2 update: persist translations, confidence score, transcription,
   * and extracted actions for a message that was already saved in Phase 1.
   */
  async updateMessageWithTranslation(
    id: string,
    updates: {
      transcription?: string | null;
      translations: Translations | null;
      detectedLanguage?: DetectedLanguage | null;
      originalTone?: string | null;
      translatedAudioUrls?: TranslatedAudioUrls | null;
      confidenceScore: number;
      extractedActions?: ExtractedAction[] | null;
    },
  ): Promise<Message> {
    const updatePayload: Partial<Message> = {
      translations: updates.translations,
      confidenceScore: updates.confidenceScore,
    };
    if (updates.transcription !== undefined) {
      updatePayload.transcription = updates.transcription as string;
    }
    if (updates.detectedLanguage !== undefined) {
      updatePayload.detectedLanguage = updates.detectedLanguage;
    }
    if (updates.originalTone !== undefined) {
      updatePayload.originalTone = updates.originalTone;
    }
    if (updates.translatedAudioUrls !== undefined) {
      updatePayload.translatedAudioUrls = updates.translatedAudioUrls;
    }
    if (updates.extractedActions !== undefined) {
      updatePayload.extractedActions = updates.extractedActions ?? null;
    }
    await this.messageRepository.update(id, updatePayload);
    return this.messageRepository.findOneOrFail({
      where: { id },
      relations: ['sender'],
    });
  }

  /**
   * Hard-deletes sender-owned messages for all participants. Validates each
   * message belongs to the requesting user and to the active group.
   */
  async deleteMessages(
    messageIds: string[],
    userId: string,
    groupId: string,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    const messages = await this.messageRepository.find({
      where: { id: In(messageIds) },
      relations: ['sender'],
    });

    for (const id of messageIds) {
      const msg = messages.find((m) => m.id === id);
      if (!msg) throw new Error(`Message ${id} not found`);
      if (msg.groupId !== groupId) {
        throw new Error('One or more messages do not belong to this group');
      }
      if (msg.sender.id !== userId) {
        throw new Error('You can only delete your own messages');
      }
    }

    await this.messageRepository.remove(messages);
  }

  /**
   * Hides received messages only for the requesting user.
   */
  async hideMessagesForUser(
    messageIds: string[],
    userId: string,
    groupId: string,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    const messages = await this.messageRepository.find({
      where: { id: In(messageIds) },
      relations: ['sender'],
    });

    for (const id of messageIds) {
      const msg = messages.find((m) => m.id === id);
      if (!msg) throw new Error(`Message ${id} not found`);
      if (msg.groupId !== groupId) {
        throw new Error('One or more messages do not belong to this group');
      }
      if (msg.sender.id === userId) {
        throw new Error('Use permanent delete for your own messages');
      }
    }

    await this.hiddenMessageRepository
      .createQueryBuilder()
      .insert()
      .into(MessageHiddenByUser)
      .values(
        messageIds.map((messageId) => ({
          message: { id: messageId },
          user: { id: userId },
        })),
      )
      .orIgnore()
      .execute();
  }

  /**
   * Edits the raw content of a TEXT message. Enforces:
   * - message exists & belongs to the user
   * - contentType is TEXT
   * - message is within the 15-minute edit window
   * Clears translations/confidenceScore so a re-translation can be triggered.
   */
  async editMessage(
    messageId: string,
    userId: string,
    newContent: string,
  ): Promise<Message> {
    const msg = await this.findMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    if (msg.sender.id !== userId) {
      throw new Error('You can only edit your own messages');
    }
    if (msg.contentType !== MessageContentType.TEXT) {
      throw new Error('Only text messages can be edited');
    }

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (msg.createdAt < fifteenMinutesAgo) {
      throw new Error(
        'Messages can only be edited within 15 minutes of sending',
      );
    }

    msg.rawContent = newContent;
    msg.isEdited = true;
    msg.translations = null;
    msg.confidenceScore = null;

    return this.messageRepository.save(msg);
  }

  /**
   * Full-text search across raw_content and transcription columns using
   * PostgreSQL's built-in tsvector/tsquery. Falls back to a flexible
   * prefix + partial matching strategy so users can search with partial
   * words and multi-term queries.
   *
   * @param groupId  Scope to a single conversation
   * @param query    User's raw search text
   * @param page     1-based page number
   * @param limit    Results per page (default 20)
   */
  async searchMessages(
    groupId: string,
    userId: string,
    query: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ results: SearchResult[]; total: number }> {
    const skip = (page - 1) * limit;

    // Sanitise: strip tsquery special chars, collapse whitespace
    const sanitised = query.replace(/[&|!<>():*'"\\]/g, ' ').trim();
    if (!sanitised) return { results: [], total: 0 };

    // Build prefix tsquery: each word becomes word:* so "hel wor" → "hel:* & wor:*"
    const terms = sanitised.split(/\s+/).filter(Boolean);
    const tsQueryExpr = terms.map((t) => `${t}:*`).join(' & ');

    // Also build ILIKE patterns for a fallback OR condition (catches partial
    // matches that the stemmer might miss, e.g. transliterated Sinhala/Tamil text).
    const ilikePattern = `%${sanitised}%`;

    const qb = this.messageRepository
      .createQueryBuilder('m')
      .innerJoin('m.sender', 'u')
      .where('m.group_id = :groupId', { groupId })
      .andWhere(
        `(
          to_tsvector('simple', COALESCE(m.raw_content, ''))  @@ to_tsquery('simple', :tsq)
          OR to_tsvector('simple', COALESCE(m.transcription, '')) @@ to_tsquery('simple', :tsq)
          OR m.raw_content ILIKE :ilike
          OR m.transcription ILIKE :ilike
        )`,
        { tsq: tsQueryExpr, ilike: ilikePattern },
      );

    this.applyVisibilityFilter(qb, userId);

    const total = await qb.getCount();

    const rows: Array<{
      m_id: string;
      m_group_id: string;
      m_content_type: MessageContentType;
      m_raw_content: string;
      m_transcription: string | null;
      m_created_at: Date;
      u_id: string;
      u_display_name: string;
      headline: string;
    }> = await qb
      .select([
        'm.id AS m_id',
        'm.group_id AS m_group_id',
        'm.content_type AS m_content_type',
        'm.raw_content AS m_raw_content',
        'm.transcription AS m_transcription',
        'm.created_at AS m_created_at',
        'u.id AS u_id',
        'u.display_name AS u_display_name',
        `ts_headline(
          'simple',
          COALESCE(
            CASE WHEN m.content_type = 'TEXT' THEN m.raw_content ELSE NULL END,
            m.transcription,
            m.raw_content
          ),
          to_tsquery('simple', :tsq),
          'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15, MaxFragments=1'
        ) AS headline`,
      ])
      .orderBy('m.created_at', 'DESC')
      .offset(skip)
      .limit(limit)
      .getRawMany();

    const results: SearchResult[] = rows.map((r) => ({
      id: r.m_id,
      groupId: r.m_group_id,
      senderId: r.u_id,
      senderName: r.u_display_name,
      contentType: r.m_content_type,
      rawContent: r.m_raw_content,
      transcription: r.m_transcription,
      headline: r.headline,
      createdAt: r.m_created_at,
    }));

    return { results, total };
  }
}

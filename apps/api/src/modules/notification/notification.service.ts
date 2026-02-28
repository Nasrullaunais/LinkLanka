import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';

import { User } from '../../core/identity/entities/user.entity';

/** Shape of a single message in the Expo push batch. */
interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data?: Record<string, string>;
}

/** Individual ticket returned by Expo Push API. */
interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
  private readonly CHUNK_SIZE = 100; // Expo docs: max 100 per request

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ── Token management ────────────────────────────────────────────────────

  async registerToken(userId: string, token: string): Promise<void> {
    await this.userRepo.update(userId, { expoPushToken: token });
    this.logger.log(`Registered push token for userId=${userId}`);
  }

  async clearToken(userId: string): Promise<void> {
    await this.userRepo.update(userId, { expoPushToken: null });
    this.logger.log(`Cleared push token for userId=${userId}`);
  }

  // ── Send notifications ──────────────────────────────────────────────────

  /**
   * Sends push notifications to the given Expo push tokens.
   * Chunks into batches of 100 as per Expo docs.
   * Never throws — failures are logged and stale tokens are cleaned up.
   */
  async sendPushNotifications(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<void> {
    if (tokens.length === 0) return;

    // Filter out obviously invalid tokens
    const validTokens = tokens.filter(
      (t) => t && t.startsWith('ExponentPushToken['),
    );

    if (validTokens.length === 0) {
      this.logger.warn('No valid Expo push tokens to send to');
      return;
    }

    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      title,
      body,
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: 'chat-messages',
      data,
    }));

    // Chunk into batches of CHUNK_SIZE
    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += this.CHUNK_SIZE) {
      chunks.push(messages.slice(i, i + this.CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      try {
        const response = await axios.post<{ data: ExpoPushTicket[] }>(
          this.EXPO_PUSH_URL,
          chunk,
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 10_000,
          },
        );

        const tickets = response.data?.data ?? [];
        await this.handleTickets(tickets, chunk);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to send push notifications: ${msg}`);
        // Never throw — notification failures must not break chat flow
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Process Expo push tickets — clean up stale tokens that return
   * `DeviceNotRegistered` so we stop sending to dead devices.
   */
  private async handleTickets(
    tickets: ExpoPushTicket[],
    sentMessages: ExpoPushMessage[],
  ): Promise<void> {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];

      if (ticket.status === 'error') {
        const errorType = ticket.details?.error;
        const token = sentMessages[i]?.to;

        this.logger.warn(
          `Push ticket error for token ${token}: ${ticket.message} (${errorType})`,
        );

        // If the device is no longer registered, remove the stale token
        if (errorType === 'DeviceNotRegistered' && token) {
          await this.nullifyStaleToken(token);
        }
      }
    }
  }

  /**
   * Remove a push token from the database when Expo reports
   * the device is no longer registered.
   */
  private async nullifyStaleToken(token: string): Promise<void> {
    try {
      const result = await this.userRepo.update(
        { expoPushToken: token },
        { expoPushToken: null },
      );
      if (result.affected && result.affected > 0) {
        this.logger.log(`Nullified stale push token: ${token.slice(0, 30)}...`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to nullify stale token: ${msg}`);
    }
  }
}

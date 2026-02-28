import { Injectable, Logger } from '@nestjs/common';
import { ExtractedAction } from '../translation/translation.service';

/**
 * ActionService — processes AI-extracted actions from chat messages.
 *
 * When the translation pipeline detects a meeting, reminder, or deadline
 * in a voice note / text message, the structured action data is forwarded
 * here for any server-side orchestration (logging, future push notifications,
 * calendar sync, etc.).
 *
 * Currently this service:
 *  - Validates and normalises the extracted actions.
 *  - Logs them for observability.
 *
 * Future extensions:
 *  - Push-notification scheduling via a job queue (Bull / Agenda).
 *  - Server-side Google Calendar / Outlook integration.
 *  - Persisting actions to a dedicated `actions` table for querying.
 */
@Injectable()
export class ActionService {
  private readonly logger = new Logger(ActionService.name);

  /**
   * Process a batch of extracted actions for a given message.
   *
   * @param messageId - The persisted message UUID.
   * @param senderId  - The user who sent the message.
   * @param groupId   - The chat group the message belongs to.
   * @param actions   - The AI-extracted actions array.
   * @returns The validated / enriched actions (passed through for broadcast).
   */
  processActions(
    messageId: string,
    senderId: string,
    groupId: string,
    actions: ExtractedAction[],
  ): ExtractedAction[] {
    if (!actions || actions.length === 0) return [];

    const validActions: ExtractedAction[] = [];

    for (const action of actions) {
      // Basic validation — skip malformed entries
      if (!action.type || !action.title || !action.timestamp) {
        this.logger.warn(
          `[processActions] Skipping malformed action for messageId=${messageId}: ${JSON.stringify(action)}`,
        );
        continue;
      }

      // Validate the timestamp is parseable
      const date = new Date(action.timestamp);
      if (isNaN(date.getTime())) {
        this.logger.warn(
          `[processActions] Invalid timestamp "${action.timestamp}" for messageId=${messageId} — skipping`,
        );
        continue;
      }

      validActions.push({
        type: action.type,
        title: action.title,
        timestamp: date.toISOString(),
        ...(action.description ? { description: action.description } : {}),
      });

      this.logger.log(
        `[processActions] Extracted ${action.type}: "${action.title}" at ${date.toISOString()} ` +
          `(messageId=${messageId}, senderId=${senderId}, groupId=${groupId})`,
      );
    }

    return validActions;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ExtractedAction } from '../translation/translation.service';

const SRI_LANKA_OFFSET_SUFFIX = '+05:30';

function normalizeTimestampToUtc(timestamp: string): string | null {
  const input = timestamp.trim().replace(' ', 'T');
  const hasExplicitZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(input);
  const isoLocalPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

  const candidate =
    hasExplicitZone || !isoLocalPattern.test(input)
      ? input
      : `${input}${SRI_LANKA_OFFSET_SUFFIX}`;

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

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

      // Normalize timestamps to canonical UTC ISO. If the model omits an offset,
      // treat the time as Sri Lanka local time to prevent server-locale drift.
      const normalizedTimestamp = normalizeTimestampToUtc(action.timestamp);
      if (!normalizedTimestamp) {
        this.logger.warn(
          `[processActions] Invalid timestamp "${action.timestamp}" for messageId=${messageId} — skipping`,
        );
        continue;
      }

      validActions.push({
        type: action.type,
        title: action.title,
        timestamp: normalizedTimestamp,
        ...(action.description ? { description: action.description } : {}),
      });

      this.logger.log(
        `[processActions] Extracted ${action.type}: "${action.title}" at ${normalizedTimestamp} ` +
          `(messageId=${messageId}, senderId=${senderId}, groupId=${groupId})`,
      );
    }

    return validActions;
  }
}

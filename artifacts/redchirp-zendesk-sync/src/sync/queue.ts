import { one, query } from '../db/index.js';
import { log } from '../log.js';
import { alert } from '../alerts.js';

export type QueuedEvent = { source: 'redchirp' | 'sunshine' | 'zendesk'; eventType: string; dedupeKey: string; conversationKey?: string; payload: unknown };

/** Adds an event once. A repeat of the same dedupe key is ignored, so retries and overlapping polls are safe. */
export async function enqueue(e: QueuedEvent): Promise<boolean> {
  const row = await one(
    `INSERT INTO event_log (source, event_type, dedupe_key, conversation_key, payload)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [e.source, e.eventType, e.dedupeKey, e.conversationKey ?? null, JSON.stringify(e.payload)],
  );
  return Boolean(row);
}

type Handler = (eventType: string, payload: any) => Promise<'done' | 'skipped'>;
const MAX_ATTEMPTS = 5;

/** Processes events one at a time in arrival order, which keeps each conversation in order. */
export async function drainQueue(handle: Handler): Promise<number> {
  const rows = await query(
    `SELECT id, source, event_type, payload, attempts FROM event_log
     WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY id LIMIT 25`,
  );
  for (const r of rows) {
    try {
      const outcome = await handle(`${r.source}:${r.event_type}`, r.payload);
      await query(`UPDATE event_log SET status = $2, payload = NULL, processed_at = NOW() WHERE id = $1`, [r.id, outcome]);
    } catch (err: any) {
      const attempts = r.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await query(
        `UPDATE event_log SET attempts = $2, note = $3, status = $4,
           next_attempt_at = NOW() + ($5 || ' seconds')::interval WHERE id = $1`,
        [r.id, attempts, String(err?.message ?? err).slice(0, 1000), failed ? 'failed' : 'pending', String(30 * 2 ** attempts)],
      );
      log('warn', 'Event failed', { id: r.id, type: r.event_type, attempts, error: String(err?.message ?? err) });
      if (failed) await alert('Event failed after retries', `Event ${r.id} (${r.source}:${r.event_type}): ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }
  return rows.length;
}

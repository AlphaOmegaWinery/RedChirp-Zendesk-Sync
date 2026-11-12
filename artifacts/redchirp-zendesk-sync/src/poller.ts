import { config } from './config.js';
import { one, query } from './db/index.js';
import { log } from './log.js';
import { redchirp } from './redchirp/index.js';
import { enqueue } from './sync/queue.js';

export const pollState = { lastPollAt: null as string | null, lastError: null as string | null };

function inBusinessHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.hours.timezone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return hour >= config.hours.startHour && hour < config.hours.endHour;
}

async function pollOnce(): Promise<void> {
  const row = await one(`SELECT cursor_value FROM sync_cursor WHERE source = 'redchirp'`);
  const { changes, nextCursor } = await redchirp.listChangesSince(row?.cursor_value ?? null);
  for (const c of changes) {
    await enqueue({ source: 'redchirp', eventType: c.kind, dedupeKey: `redchirp:${c.changeId}`, conversationKey: c.conversationId, payload: c });
  }
  await query(
    `INSERT INTO sync_cursor (source, cursor_value) VALUES ('redchirp', $1)
     ON CONFLICT (source) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = NOW()`,
    [nextCursor],
  );
  pollState.lastPollAt = new Date().toISOString();
  pollState.lastError = null;
  if (changes.length) log('info', 'Polled RedChirp', { changes: changes.length });
}

export function startPoller(): void {
  const loop = async () => {
    try {
      await pollOnce();
    } catch (e: any) {
      pollState.lastError = String(e?.message ?? e);
      log('warn', 'RedChirp poll failed', { error: pollState.lastError });
    }
    const secs = inBusinessHours() ? config.hours.pollSecondsBusiness : config.hours.pollSecondsAfterHours;
    setTimeout(loop, secs * 1000);
  };
  void loop();
}

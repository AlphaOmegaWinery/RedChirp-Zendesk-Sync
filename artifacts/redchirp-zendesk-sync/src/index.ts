import express from 'express';
import { config, requireConfig } from './config.js';
import { query } from './db/index.js';
import { log } from './log.js';
import { webhooks } from './webhooks.js';
import { startPoller, pollState } from './poller.js';
import { drainQueue } from './sync/queue.js';
import { handle } from './sync/handlers.js';
import { usingMock } from './redchirp/index.js';

requireConfig(['DATABASE_URL']);
for (const k of ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN', 'SUNSHINE_APP_ID', 'SUNSHINE_KEY_ID', 'SUNSHINE_SECRET', 'SUNSHINE_WEBHOOK_SECRET', 'ZENDESK_WEBHOOK_SECRET']) {
  if (!process.env[k]) log('warn', `Secret ${k} is not set yet`);
}

const app = express();
app.use(webhooks);
app.get('/', (_req, res) => res.redirect('/health'));

app.get('/health', async (_req, res) => {
  const [counts] = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour') AS failed_last_hour
     FROM event_log`,
  );
  res.json({
    ok: !pollState.lastError,
    dryRun: config.dryRun,
    redchirp: usingMock ? 'mock' : 'live',
    redchirpCapabilities: {
      messagePolling: usingMock ? 'mock' : 'public-api',
      conversationStatePolling: 'blocked: private API contract required',
      sendAssignArchiveUnarchiveAndNotes: 'blocked: private API contract required',
    },
    lastPollAt: pollState.lastPollAt,
    lastPollError: pollState.lastError,
    queuePending: Number(counts.pending),
    failedLastHour: Number(counts.failed_last_hour),
  });
});

app.listen(config.port, '0.0.0.0', () => {
  log('info', 'redchirp-zendesk-sync started', { port: config.port, dryRun: config.dryRun, redchirp: usingMock ? 'mock' : 'live' });
});

startPoller();

let draining = false;
setInterval(async () => {
  if (draining) return;
  draining = true;
  try {
    await drainQueue(handle);
  } catch (e) {
    log('error', 'Queue loop error', { error: String(e) });
  } finally {
    draining = false;
  }
}, 2000);

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { log } from './log.js';
import { enqueue } from './sync/queue.js';
import { mockRedChirp, usingMock } from './redchirp/index.js';

export const webhooks = express.Router();
// Keep the raw body: signatures are computed over the exact bytes Zendesk sent.
const raw = express.raw({ type: '*/*', limit: '2mb' });

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Conversations API webhook: every message in every conversation. We act on agent replies only.
webhooks.post('/webhooks/conversations', raw, async (req: Request, res: Response) => {
  const key = String(req.header('x-api-key') ?? '');
  if (!config.sunshine.webhookSecret || !safeEqual(key, config.sunshine.webhookSecret)) {
    log('warn', 'Rejected Conversations webhook: bad or missing secret');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // acknowledge first; process from the queue
  try {
    const body = JSON.parse(req.body.toString('utf8'));
    for (const ev of body.events ?? []) {
      if (ev.type !== 'conversation:message') continue;
      await enqueue({
        source: 'sunshine',
        eventType: ev.type,
        dedupeKey: `sunshine:${ev.id ?? ev.payload?.message?.id}`,
        conversationKey: ev.payload?.conversation?.id,
        payload: ev,
      });
    }
  } catch (e) {
    log('error', 'Could not queue Conversations webhook', { error: String(e) });
  }
});

// Zendesk trigger webhook: ticket created, assignee changed, status changed.
webhooks.post('/webhooks/zendesk', raw, async (req: Request, res: Response) => {
  const sig = String(req.header('x-zendesk-webhook-signature') ?? '');
  const ts = String(req.header('x-zendesk-webhook-signature-timestamp') ?? '');
  const rawBody: Buffer = req.body;
  const expected = createHmac('sha256', config.zendesk.webhookSecret).update(ts + rawBody.toString('utf8')).digest('base64');
  if (!config.zendesk.webhookSecret || !sig || !safeEqual(sig, expected)) {
    log('warn', 'Rejected Zendesk webhook: bad signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  try {
    const body = JSON.parse(rawBody.toString('utf8'));
    await enqueue({
      source: 'zendesk',
      eventType: 'ticket_event',
      dedupeKey: `zendesk:${createHash('sha1').update(ts + rawBody.toString('utf8')).digest('hex')}`,
      conversationKey: String(body.ticket_id ?? ''),
      payload: body,
    });
  } catch (e) {
    log('error', 'Could not queue Zendesk webhook', { error: String(e) });
  }
});

// Development only: inject a fake guest text while RedChirp is mocked.
webhooks.post('/dev/mock-text', express.json(), (req: Request, res: Response) => {
  if (!usingMock) return res.status(404).send('Mock RedChirp is off');
  if (process.env.DEV_TOKEN && req.header('x-dev-token') !== process.env.DEV_TOKEN) return res.sendStatus(401);
  const { conversationId = 'test-conv-1', phone = '+17075550100', text = 'Hi, can I move my tasting to 3pm?', first, last } = req.body ?? {};
  mockRedChirp.inject({
    kind: 'message',
    conversationId,
    messageId: `mock-in-${Date.now()}`,
    phone,
    direction: 'inbound',
    text,
    contactName: { first, last },
    occurredAt: new Date().toISOString(),
  } as any);
  res.json({ queued: true, conversationId });
});

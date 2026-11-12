import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { log } from '../log.js';
import { alert } from '../alerts.js';
import * as sc from '../zendesk/sunshine.js';
import * as zd from '../zendesk/ticketing.js';
import { redchirp } from '../redchirp/index.js';
import type { RedChirpChange } from '../redchirp/types.js';
import { extractText, isAckOnly, isNoise, normalizePhone } from './filters.js';

// Everything this service writes is tagged with ORIGIN, so it is never copied back (no echo loops).
const ORIGIN = 'redchirp-sync';
const DONE_STATES = ['solved', 'closed'];
const dry = (what: string, detail: Record<string, unknown>) => log('info', `DRY_RUN would ${what}`, detail);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

const convByRc = (id: string) => one(`SELECT * FROM conversation_map WHERE redchirp_conversation_id = $1`, [id]);
const convBySunshine = (id: string) => one(`SELECT * FROM conversation_map WHERE sunshine_conversation_id = $1`, [id]);
const convByTicket = (id: number) => one(`SELECT * FROM conversation_map WHERE active_ticket_id = $1`, [id]);
const rcUserForZendesk = (zdId: number) =>
  one(`SELECT redchirp_user_id, email FROM user_map WHERE zendesk_user_id = $1 AND active`, [zdId]);
const zdUserForRc = (rcId: string) =>
  one(`SELECT zendesk_user_id, email FROM user_map WHERE redchirp_user_id = $1 AND active`, [rcId]);

function passControlMetadata(rcConversationId: string): Record<string, string> {
  // Asks Zendesk to tag the new ticket and store the RedChirp conversation ID on it. Confirm in the spike.
  const md: Record<string, string> = { 'dataCapture.systemField.tags': 'sms' };
  if (config.zendesk.rcConversationFieldId) md[`dataCapture.ticketField.${config.zendesk.rcConversationFieldId}`] = rcConversationId;
  return md;
}

export async function handle(type: string, payload: any): Promise<'done' | 'skipped'> {
  switch (type) {
    case 'redchirp:message':
      return payload.direction === 'outbound' ? onRcStaffMessage(payload) : onRcGuestMessage(payload);
    case 'redchirp:assignment':
      return onRcAssignment(payload);
    case 'redchirp:archive':
      return onRcArchive(payload);
    case 'redchirp:unarchive':
      return 'skipped'; // the guest's next text reopens the ticket
    case 'sunshine:conversation:message':
      return onAgentReply(payload);
    case 'zendesk:ticket_event':
      return onTicketEvent(payload);
    default:
      log('warn', 'Unknown event type', { type });
      return 'skipped';
  }
}

// R1 to R4, R10: a guest texts in RedChirp.
async function onRcGuestMessage(change: Extract<RedChirpChange, { kind: 'message' }>): Promise<'done' | 'skipped'> {
  if (isNoise(change.text, change.isSystemEvent)) return 'skipped';
  const c = { ...change, text: extractText(change.text) };
  let conv = await convByRc(c.conversationId);
  const solved = DONE_STATES.includes(conv?.last_synced_status ?? '');
  if (solved && config.skipAckOnlyOnSolved && isAckOnly(c.text)) {
    log('info', 'Thanks-only text on a solved ticket; not reopening', { conversationId: c.conversationId });
    return 'skipped';
  }
  const phone = normalizePhone(c.phone);
  const externalId = `phone:${phone}`;
  if (config.dryRun) {
    dry('post guest text to Zendesk', { conversationId: c.conversationId, newConversation: !conv?.sunshine_conversation_id });
    return 'done';
  }

  await sc.ensureUser(externalId, { givenName: c.contactName?.first, surname: c.contactName?.last });
  let isNew = false;
  if (!conv?.sunshine_conversation_id) {
    const created = await sc.createConversation(externalId, { redchirpConversationId: c.conversationId });
    await query(
      `INSERT INTO conversation_map (redchirp_conversation_id, phone, sunshine_user_external_id, sunshine_conversation_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (redchirp_conversation_id) DO UPDATE SET sunshine_conversation_id = EXCLUDED.sunshine_conversation_id, updated_at = NOW()`,
      [c.conversationId, phone, externalId, created.id],
    );
    conv = await convByRc(c.conversationId);
    isNew = true;
  }

  const msg = await sc.postUserMessage(conv.sunshine_conversation_id, externalId, c.text, { origin: ORIGIN, redchirpMessageId: c.messageId });
  await query(
    `INSERT INTO message_map (redchirp_message_id, sunshine_message_id, redchirp_conversation_id, direction, origin, ticket_id)
     VALUES ($1, $2, $3, 'inbound', 'redchirp', $4) ON CONFLICT DO NOTHING`,
    [c.messageId, msg?.id ?? null, c.conversationId, conv.active_ticket_id],
  );

  if (isNew || !conv.active_ticket_id || solved) {
    try {
      await sc.passControl(conv.sunshine_conversation_id, passControlMetadata(c.conversationId));
    } catch (e: any) {
      // Already with Agent Workspace is fine; anything else is retried.
      if (e?.status !== 400 && e?.status !== 409) throw e;
      log('info', 'passControl not needed', { conversationId: c.conversationId, status: e?.status });
    }
  }
  await query(`UPDATE conversation_map SET last_message_direction = 'inbound', updated_at = NOW() WHERE redchirp_conversation_id = $1`, [c.conversationId]);
  return 'done';
}

// R5 (transition only): staff replied from RedChirp instead of Zendesk.
async function onRcStaffMessage(change: Extract<RedChirpChange, { kind: 'message' }>): Promise<'done' | 'skipped'> {
  if (await one(`SELECT 1 FROM message_map WHERE redchirp_message_id = $1`, [change.messageId])) return 'skipped'; // sent by us
  if (isNoise(change.text, change.isSystemEvent)) return 'skipped';
  const c = { ...change, text: extractText(change.text) };
  const conv = await convByRc(c.conversationId);
  if (!conv?.sunshine_conversation_id) return 'skipped'; // no Zendesk conversation yet
  const staff = c.sentByUserId ? await zdUserForRc(c.sentByUserId) : undefined;
  const name = staff ? (await zd.getUser(Number(staff.zendesk_user_id)))?.name ?? 'Alpha Omega' : 'Alpha Omega';
  if (config.dryRun) {
    dry('copy RedChirp staff reply into Zendesk', { conversationId: c.conversationId, staff: name });
    return 'done';
  }
  const msg = await sc.postBusinessMessage(conv.sunshine_conversation_id, name, c.text, { origin: ORIGIN, redchirpMessageId: c.messageId, sentIn: 'RedChirp' });
  await query(
    `INSERT INTO message_map (redchirp_message_id, sunshine_message_id, redchirp_conversation_id, direction, origin, ticket_id)
     VALUES ($1, $2, $3, 'outbound', 'redchirp', $4) ON CONFLICT DO NOTHING`,
    [c.messageId, msg?.id ?? null, c.conversationId, conv.active_ticket_id],
  );
  await query(`UPDATE conversation_map SET last_message_direction = 'outbound', updated_at = NOW() WHERE redchirp_conversation_id = $1`, [c.conversationId]);
  return 'done';
}

// R6, R7: assignment changed in RedChirp.
async function onRcAssignment(c: Extract<RedChirpChange, { kind: 'assignment' }>): Promise<'done' | 'skipped'> {
  const conv = await convByRc(c.conversationId);
  if (!conv?.active_ticket_id) return 'skipped';
  const target = c.assignedUserId ? await zdUserForRc(c.assignedUserId) : null;
  if (c.assignedUserId && !target) {
    await alert('Unmapped RedChirp user', `RedChirp user ${c.assignedUserId} has no Zendesk match in user_map.`);
    return 'skipped';
  }
  const targetId = target ? Number(target.zendesk_user_id) : null;
  if (targetId === num(conv.last_synced_assignee_zendesk_id)) return 'skipped';
  const actor = c.byUserId ? await zdUserForRc(c.byUserId) : undefined;
  if (config.dryRun) {
    dry('set Zendesk assignee', { ticketId: conv.active_ticket_id, assignee: targetId, as: actor?.email ?? 'RedChirp Sync' });
    return 'done';
  }
  // Record first, so the Zendesk webhook this causes is recognized as our own change.
  await query(`UPDATE conversation_map SET last_synced_assignee_zendesk_id = $2, updated_at = NOW() WHERE id = $1`, [conv.id, targetId]);
  await zd.updateTicket(Number(conv.active_ticket_id), { assignee_id: targetId }, actor?.email);
  return 'done';
}

// R8: archived in RedChirp, so solve in Zendesk.
async function onRcArchive(c: Extract<RedChirpChange, { kind: 'archive' | 'unarchive' }>): Promise<'done' | 'skipped'> {
  const conv = await convByRc(c.conversationId);
  if (!conv?.active_ticket_id || DONE_STATES.includes(conv.last_synced_status ?? '')) return 'skipped';
  const actor = c.byUserId ? await zdUserForRc(c.byUserId) : undefined;
  const update: Record<string, unknown> = { status: 'solved' };
  if (config.zendesk.closeReasonFieldId) {
    update.custom_fields = [{ id: Number(config.zendesk.closeReasonFieldId), value: config.zendesk.closeReasonArchivedValue }];
  }
  if (conv.last_message_direction === 'inbound') update.additional_tags = ['closed_without_reply'];
  if (config.dryRun) {
    dry('solve Zendesk ticket', { ticketId: conv.active_ticket_id, as: actor?.email ?? 'RedChirp Sync', update });
    return 'done';
  }
  await query(`UPDATE conversation_map SET last_synced_status = 'solved', updated_at = NOW() WHERE id = $1`, [conv.id]);
  await zd.updateTicket(Number(conv.active_ticket_id), update, actor?.email);
  return 'done';
}

// Z1: an agent replied in Zendesk. Send it in RedChirp on behalf of that agent.
async function onAgentReply(event: any): Promise<'done' | 'skipped'> {
  const m = event?.payload?.message;
  const sunshineConvId = event?.payload?.conversation?.id;
  if (!m || m.author?.type !== 'business') return 'skipped'; // guest messages, including ours
  if (m.metadata?.origin === ORIGIN) return 'skipped'; // copied in from RedChirp
  if (m.content?.type !== 'text' || !m.content.text) {
    log('warn', 'Non-text agent message not sent yet', { type: m.content?.type });
    return 'skipped';
  }
  if (await one(`SELECT 1 FROM message_map WHERE sunshine_message_id = $1`, [m.id])) return 'skipped';
  const conv = await convBySunshine(sunshineConvId);
  if (!conv) return 'skipped';
  // Thrown errors are retried with backoff, which covers a ticket or comment that Zendesk hasn't finished creating.
  if (!conv.active_ticket_id) throw new Error('Ticket for this conversation is not known yet');
  const ticketId = Number(conv.active_ticket_id);
  const authorId = await zd.findReplyAuthor(ticketId, m.content.text, new Date(m.received ?? Date.now()));
  if (!authorId) throw new Error(`Could not match the reply to an agent comment on ticket ${ticketId}`);
  const agent = await rcUserForZendesk(authorId);
  if (!agent) {
    if (!config.dryRun) {
      await zd.addInternalNote(ticketId, 'This reply was NOT sent as a text: your Zendesk user is not linked to a RedChirp user yet. Ask Business Systems to add you, then resend.');
    }
    await alert('Agent not mapped to RedChirp', `Zendesk user ${authorId} replied on ticket ${ticketId} but has no RedChirp user in user_map.`);
    return 'skipped';
  }
  if (config.dryRun) {
    dry('send text in RedChirp on behalf of agent', { ticketId, conversationId: conv.redchirp_conversation_id, agent: agent.email });
    return 'done';
  }
  const sent = await redchirp.sendMessage({
    conversationId: conv.redchirp_conversation_id,
    onBehalfOfUserId: agent.redchirp_user_id,
    text: m.content.text,
  });
  await query(
    `INSERT INTO message_map (redchirp_message_id, sunshine_message_id, redchirp_conversation_id, direction, origin, ticket_id)
     VALUES ($1, $2, $3, 'outbound', 'zendesk', $4) ON CONFLICT DO NOTHING`,
    [sent.messageId, m.id, conv.redchirp_conversation_id, ticketId],
  );
  await query(`UPDATE conversation_map SET last_message_direction = 'outbound', updated_at = NOW() WHERE id = $1`, [conv.id]);
  return 'done';
}

// Ticket created, Z3, Z4, Z5: from Zendesk trigger webhooks (body format in README).
async function onTicketEvent(p: any): Promise<'done' | 'skipped'> {
  const ticketId = Number(p.ticket_id);
  if (!ticketId) return 'skipped';
  let conv = p.rc_conversation_id ? await convByRc(String(p.rc_conversation_id)) : await convByTicket(ticketId);
  if (!conv) return 'skipped'; // not a text ticket
  if (num(conv.active_ticket_id) !== ticketId) {
    await query(`UPDATE conversation_map SET active_ticket_id = $2, last_synced_status = NULL, updated_at = NOW() WHERE id = $1`, [conv.id, ticketId]);
    conv = await convByRc(conv.redchirp_conversation_id);
  }
  const actor = num(p.current_user_id) ? await rcUserForZendesk(Number(p.current_user_id)) : undefined;
  const rcConv = conv.redchirp_conversation_id;

  // Assignment
  const assignee = num(p.assignee_id);
  if (assignee !== num(conv.last_synced_assignee_zendesk_id)) {
    const rcUser = assignee ? await rcUserForZendesk(assignee) : null;
    if (assignee && !rcUser) {
      await alert('Agent not mapped to RedChirp', `Ticket ${ticketId} was assigned to Zendesk user ${assignee}, who has no RedChirp user.`);
    } else if (config.dryRun) {
      dry('assign RedChirp conversation', { conversationId: rcConv, to: rcUser?.redchirp_user_id ?? null });
    } else {
      await query(`UPDATE conversation_map SET last_synced_assignee_zendesk_id = $2, updated_at = NOW() WHERE id = $1`, [conv.id, assignee]);
      await redchirp.assign({ conversationId: rcConv, userId: rcUser?.redchirp_user_id ?? null, byUserId: actor?.redchirp_user_id });
    }
  }

  // Status
  const status = String(p.status ?? '').toLowerCase().replace('on-hold', 'hold');
  const prev = conv.last_synced_status as string | null;
  if (status && status !== prev) {
    if (config.dryRun) {
      dry('mirror Zendesk status in RedChirp', { conversationId: rcConv, from: prev, to: status });
    } else {
      await query(`UPDATE conversation_map SET last_synced_status = $2, updated_at = NOW() WHERE id = $1`, [conv.id, status]);
      if (status === 'solved' && prev !== 'closed') await redchirp.archive({ conversationId: rcConv, byUserId: actor?.redchirp_user_id });
      else if (prev === 'solved' && ['new', 'open', 'pending', 'hold'].includes(status)) {
        await redchirp.unarchive({ conversationId: rcConv, byUserId: actor?.redchirp_user_id });
      }
      if (status === 'closed') {
        // The next text starts a new ticket.
        await query(`UPDATE conversation_map SET active_ticket_id = NULL, updated_at = NOW() WHERE id = $1`, [conv.id]);
      }
    }
  }
  return 'done';
}

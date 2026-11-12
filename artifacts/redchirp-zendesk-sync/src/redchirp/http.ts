import { config } from '../config.js';
import type { RedChirpChange, RedChirpClient } from './types.js';
import { PublicRedChirpApi, object, text } from './public.js';
import { endpointPhone } from './phone-map.js';

// Approved public-messages-only implementation. Private conversation contracts are NOT in the spec.
const blocked = (what: string): never => {
  throw new Error(`BLOCKED: RedChirp ${what} requires the private conversations API contract; no request was sent.`);
};

export class HttpRedChirpClient implements RedChirpClient {
  private readonly api: PublicRedChirpApi;
  constructor(baseUrl = config.redchirp.baseUrl, apiKey = config.redchirp.apiKey,
    api?: PublicRedChirpApi, private readonly now: () => Date = () => new Date()) {
    this.api = api ?? new PublicRedChirpApi({ ...config.redchirp, baseUrl, apiKey });
  }

  async listChangesSince(cursor: string | null): Promise<{ changes: RedChirpChange[]; nextCursor: string }> {
    const through = this.now().getTime();
    let previous = 0;
    if (cursor !== null) {
      let parsed: Record<string, unknown>;
      try { parsed = object(JSON.parse(cursor), 'message cursor'); }
      catch { throw new Error('Invalid RedChirp public-message cursor; mock cursors cannot be reused for live polling'); }
      if (parsed.version !== 1 || typeof parsed.through !== 'string') throw new Error('Unsupported RedChirp cursor');
      previous = Date.parse(parsed.through);
      if (!Number.isFinite(previous) || previous < 0 || previous > through) throw new Error('Invalid RedChirp cursor timestamp');
    }
    const since = Math.max(0, previous - 120_000);
    const records = await this.api.list('message', {
      'time[gte]': new Date(since).toISOString(),
      'time[lte]': new Date(through).toISOString(),
    });
    const unique = new Map<string, RedChirpChange>();
    for (const row of records) {
      const messageId = text(row.message_id, 'message_id');
      const conversationId = text(row.conversation_id, 'conversation_id');
      if (row.direction !== 'inbound' && row.direction !== 'outbound') throw new Error('Invalid RedChirp message direction');
      // The OpenAPI example defines time as Unix milliseconds.
      if (typeof row.time !== 'number' || !Number.isFinite(row.time) || row.time < 0) throw new Error('Invalid RedChirp message time');
      if (row.time < since || row.time > through) throw new Error('RedChirp message fell outside the requested time window');
      const contentType = text(row.content_type, 'message content_type');
      const plainText = contentType === 'text/plain';
      if (plainText && typeof row.content !== 'string') throw new Error('Invalid RedChirp text content');
      const phone = endpointPhone(row.direction === 'inbound' ? row.author : row.single_endpoint_to);
      const change: RedChirpChange = {
        kind: 'message', changeId: `message:${messageId}`, messageId, conversationId, phone,
        direction: row.direction, text: plainText ? row.content as string : '',
        occurredAt: new Date(row.time).toISOString(),
        isSystemEvent: !plainText,
        ...(row.authored_by_employee_id == null ? {} : {
          sentByUserId: text(row.authored_by_employee_id, 'authored_by_employee_id'),
        }),
      };
      const prior = unique.get(messageId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(change)) throw new Error('Conflicting duplicate RedChirp message');
      unique.set(messageId, change);
    }
    const changes = [...unique.values()].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.changeId.localeCompare(b.changeId));
    return { changes, nextCursor: JSON.stringify({ version: 1, through: new Date(through).toISOString() }) };
  }

  async sendMessage(_args: { conversationId: string; onBehalfOfUserId: string; text: string }): Promise<{ messageId: string }> {
    return blocked('sendMessage on behalf of a user');
  }
  async assign(_args: { conversationId: string; userId: string | null; byUserId?: string }): Promise<void> {
    return blocked('assign and explanatory note');
  }
  async archive(_args: { conversationId: string; byUserId?: string }): Promise<void> {
    return blocked('archive and explanatory note');
  }
  async unarchive(_args: { conversationId: string; byUserId?: string }): Promise<void> {
    return blocked('unarchive');
  }
}

import type { RedChirpChange, RedChirpClient } from './types.js';
import { log } from '../log.js';

// Stands in for RedChirp until the API spec and key arrive. Inject test texts with POST /dev/mock-text.
export class MockRedChirpClient implements RedChirpClient {
  private queue: RedChirpChange[] = [];
  private seq = 0;

  inject(change: Omit<RedChirpChange, 'changeId'>): void {
    this.queue.push({ ...(change as any), changeId: `mock-${++this.seq}` });
  }

  async listChangesSince(cursor: string | null) {
    const changes = this.queue.splice(0);
    return { changes, nextCursor: String(this.seq || cursor || 0) };
  }
  async sendMessage(args: { conversationId: string; onBehalfOfUserId: string; text: string }) {
    log('info', 'MOCK RedChirp send', { conversationId: args.conversationId, onBehalfOf: args.onBehalfOfUserId });
    return { messageId: `mock-msg-${++this.seq}` };
  }
  async assign(args: { conversationId: string; userId: string | null }) {
    log('info', 'MOCK RedChirp assign', args);
  }
  async archive(args: { conversationId: string }) {
    log('info', 'MOCK RedChirp archive', args);
  }
  async unarchive(args: { conversationId: string }) {
    log('info', 'MOCK RedChirp unarchive', args);
  }
}

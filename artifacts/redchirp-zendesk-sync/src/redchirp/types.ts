// The shape the sync engine needs from RedChirp. The real endpoints get filled in from the RedChirp OpenAPI spec.

export type RedChirpChange =
  | {
      kind: 'message';
      changeId: string; // unique and stable, used for de-duplication
      conversationId: string;
      messageId: string;
      phone: string; // E.164, e.g. +17075551234
      direction: 'inbound' | 'outbound';
      text: string;
      sentByUserId?: string; // RedChirp user who sent an outbound message
      contactName?: { first?: string; last?: string };
      occurredAt: string; // ISO timestamp
      isSystemEvent?: boolean; // payments, uploads, assignment notices, etc.
    }
  | { kind: 'assignment'; changeId: string; conversationId: string; assignedUserId: string | null; byUserId?: string; occurredAt: string }
  | { kind: 'archive' | 'unarchive'; changeId: string; conversationId: string; byUserId?: string; occurredAt: string };

export interface RedChirpClient {
  /** Changes after the cursor, oldest first, plus the cursor to use next time. */
  listChangesSince(cursor: string | null): Promise<{ changes: RedChirpChange[]; nextCursor: string }>;
  /** Sends a text on behalf of a RedChirp user. Returns RedChirp's message ID. */
  sendMessage(args: { conversationId: string; onBehalfOfUserId: string; text: string }): Promise<{ messageId: string }>;
  assign(args: { conversationId: string; userId: string | null; byUserId?: string }): Promise<void>;
  archive(args: { conversationId: string; byUserId?: string }): Promise<void>;
  unarchive(args: { conversationId: string; byUserId?: string }): Promise<void>;
}

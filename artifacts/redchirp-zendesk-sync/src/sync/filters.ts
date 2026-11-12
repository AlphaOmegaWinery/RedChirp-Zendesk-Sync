// Texts that should never become tickets, based on the six-month inbound review.
const KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'start', 'unstop', 'yes', 'y']);
const REACTION = /^(liked|loved|disliked|laughed at|emphasized|questioned|reacted)\b/i;
const MONTHLY_OPT_OUT = /^[a-z]{3}off$/i; // e.g. JUNOFF, OCTOFF
const ACK = /(thank|thx|ok|okay|sounds good|great|perfect|you'?re welcome|all good|awesome|see you|will do|got it|cheers|have a)/i;

export function isNoise(text: string, isSystemEvent = false): boolean {
  if (isSystemEvent) return true;
  const t = (text ?? '').trim();
  if (!t) return true;
  if (t.startsWith('{') && !t.startsWith('{"contentMessage"')) return true; // RedChirp system events
  const lower = t.toLowerCase();
  return KEYWORDS.has(lower) || MONTHLY_OPT_OUT.test(lower) || REACTION.test(t);
}

/** A short thanks or acknowledgment with no question in it. */
export function isAckOnly(text: string): boolean {
  const t = (text ?? '').trim();
  return t.length < 60 && !t.includes('?') && ACK.test(t);
}

/** Phone number in E.164 form, assuming US numbers when no country code is given. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

/** RedChirp stores some texts (web-to-text, rich messages) as {"contentMessage":{"text":...}}. Returns the plain text. */
export function extractText(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t.startsWith('{"contentMessage"')) return t;
  try {
    return String(JSON.parse(t)?.contentMessage?.text ?? '').trim();
  } catch {
    return t;
  }
}

// Zendesk Ticketing API. Used for who-did-what (comment authors), assignment, status, and notes.
// The API token works with any user's email, so actions can be made as the real person.
import { config } from '../config.js';
import { basicAuth, request } from '../http.js';

const base = () => `https://${config.zendesk.subdomain}.zendesk.com/api/v2`;
const headers = (asEmail?: string) => ({
  authorization: basicAuth(`${asEmail || config.zendesk.email}/token`, config.zendesk.apiToken),
  'content-type': 'application/json',
});

export async function getTicket(ticketId: number, includeSlas = false): Promise<any> {
  const res = await request(`${base()}/tickets/${ticketId}.json${includeSlas ? '?include=slas' : ''}`, { headers: headers() });
  return includeSlas ? res : res.ticket;
}

export async function getTicketMetrics(ticketId: number): Promise<any> {
  const res = await request(`${base()}/tickets/${ticketId}/metrics.json`, { headers: headers() });
  return res.ticket_metric;
}

export async function getComments(ticketId: number): Promise<any[]> {
  const res = await request(`${base()}/tickets/${ticketId}/comments.json?sort_order=desc&per_page=50`, { headers: headers() });
  return res.comments ?? [];
}

export async function updateTicket(ticketId: number, ticket: Record<string, unknown>, asEmail?: string): Promise<any> {
  const res = await request(`${base()}/tickets/${ticketId}.json`, {
    method: 'PUT',
    headers: headers(asEmail),
    body: JSON.stringify({ ticket }),
  });
  return res.ticket;
}

export async function addInternalNote(ticketId: number, body: string): Promise<void> {
  await updateTicket(ticketId, { comment: { body, public: false } });
}

export async function getUser(userId: number): Promise<any> {
  const res = await request(`${base()}/users/${userId}.json`, { headers: headers() });
  return res.user;
}

// Finds which agent wrote a reply: the newest public agent comment whose text matches, within a few minutes.
export async function findReplyAuthor(ticketId: number, text: string, sentAt: Date): Promise<number | null> {
  const comments = await getComments(ticketId);
  const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();
  const target = norm(text);
  for (const c of comments) {
    if (!c.public) continue;
    const delta = Math.abs(new Date(c.created_at).getTime() - sentAt.getTime());
    if (delta > 5 * 60_000) continue;
    const body = norm(c.plain_body ?? c.body);
    if (body === target || body.includes(target) || target.includes(body)) return c.author_id;
  }
  return null;
}

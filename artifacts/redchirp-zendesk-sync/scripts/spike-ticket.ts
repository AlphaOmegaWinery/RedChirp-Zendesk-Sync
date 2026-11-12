// Spike step 2: shows a ticket's SLA policy, metrics, and comment authors, to confirm SLAs apply to messaging tickets.
import { requireConfig } from '../src/config.js';
import * as zd from '../src/zendesk/ticketing.js';

requireConfig(['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN']);
const ticketId = Number(process.argv[2]);
if (!ticketId) throw new Error('Usage: npm run spike:ticket -- <ticket id>');

const withSlas = await zd.getTicket(ticketId, true);
const t = withSlas.ticket;
console.log('Ticket', t.id, '| status', t.status, '| via', t.via?.channel, '| tags', t.tags?.join(', '));
console.log('Assignee', t.assignee_id, '| custom fields', JSON.stringify(t.custom_fields?.filter((f: any) => f.value)));
console.log('SLA policy:', JSON.stringify(withSlas.slas ?? t.slas ?? 'none returned', null, 2));
const metrics = await zd.getTicketMetrics(ticketId);
console.log('Reply time (calendar / business minutes):', JSON.stringify(metrics?.reply_time_in_minutes));
const comments = await zd.getComments(ticketId);
for (const c of comments.slice(0, 5)) {
  console.log(`- ${c.created_at} author ${c.author_id} ${c.public ? 'public' : 'internal'}: ${(c.plain_body ?? c.body ?? '').slice(0, 60)}`);
}

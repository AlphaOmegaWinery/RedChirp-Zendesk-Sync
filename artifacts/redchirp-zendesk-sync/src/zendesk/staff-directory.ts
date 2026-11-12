// Read-only addition for the mapping job. The baseline Zendesk clients are unchanged.
import { config } from '../config.js';
import { basicAuth, request } from '../http.js';
import { object, type JsonObject } from '../redchirp/public.js';

export async function listZendeskStaff(
  read: (url: string, init: RequestInit) => Promise<unknown> = request,
): Promise<JsonObject[]> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(config.zendesk.subdomain) ||
      !config.zendesk.email || !config.zendesk.apiToken) {
    throw new Error('Zendesk subdomain, email, and API token are required for staff mapping');
  }
  const origin = `https://${config.zendesk.subdomain}.zendesk.com`;
  let next: string | null = `${origin}/api/v2/users.json?per_page=100`;
  const visited = new Set<string>();
  const staff: JsonObject[] = [];
  while (next) {
    const url: URL = new URL(next);
    if (url.origin !== origin || url.pathname !== '/api/v2/users.json' || url.username || url.password || url.hash) {
      throw new Error('Rejected unsafe Zendesk staff pagination link');
    }
    if (visited.has(url.href)) throw new Error('Zendesk staff pagination repeated a page');
    visited.add(url.href);
    let envelope: JsonObject;
    try {
      envelope = object(await read(url.href, {
        headers: {
          authorization: basicAuth(`${config.zendesk.email}/token`, config.zendesk.apiToken),
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      }), 'Zendesk users response');
    } catch {
      throw new Error('Zendesk staff read failed; check credentials and connectivity');
    }
    if (!Array.isArray(envelope.users)) throw new Error('Invalid Zendesk users array');
    for (const item of envelope.users) {
      const user = object(item, 'Zendesk user');
      if (user.role === 'agent' || user.role === 'admin') staff.push(user);
    }
    if (envelope.next_page != null && typeof envelope.next_page !== 'string') {
      throw new Error('Invalid Zendesk next_page');
    }
    next = typeof envelope.next_page === 'string' ? envelope.next_page : null;
  }
  return staff;
}

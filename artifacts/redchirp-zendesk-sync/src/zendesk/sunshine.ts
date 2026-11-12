// Zendesk Conversations API (Sunshine Conversations). Carries the messages themselves.
// Auth is the app key from Admin Center > APIs > Conversations API, not a Zendesk user.
import { config } from '../config.js';
import { basicAuth, request } from '../http.js';

const base = () => `https://${config.zendesk.subdomain}.zendesk.com/sc/v2/apps/${config.sunshine.appId}`;
const headers = () => ({
  authorization: basicAuth(config.sunshine.keyId, config.sunshine.secret),
  'content-type': 'application/json',
});

export async function getUser(externalId: string): Promise<any | null> {
  try {
    const res = await request(`${base()}/users/${encodeURIComponent(externalId)}`, { headers: headers() });
    return res.user ?? null;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function createUser(externalId: string, profile: { givenName?: string; surname?: string } = {}): Promise<any> {
  const res = await request(`${base()}/users`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ externalId, profile }),
  });
  return res.user;
}

export async function ensureUser(externalId: string, profile: { givenName?: string; surname?: string } = {}): Promise<any> {
  return (await getUser(externalId)) ?? createUser(externalId, profile);
}

export async function createConversation(userExternalId: string, metadata: Record<string, unknown> = {}): Promise<any> {
  const res = await request(`${base()}/conversations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ type: 'personal', participants: [{ userExternalId }], metadata }),
  });
  return res.conversation;
}

export async function postUserMessage(conversationId: string, userExternalId: string, text: string, metadata: Record<string, unknown>): Promise<any> {
  const res = await request(`${base()}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ author: { type: 'user', userExternalId }, content: { type: 'text', text }, metadata }),
  });
  return res.messages?.[0];
}

// Used only during the transition, when staff still reply from RedChirp.
export async function postBusinessMessage(conversationId: string, displayName: string, text: string, metadata: Record<string, unknown>): Promise<any> {
  const res = await request(`${base()}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ author: { type: 'business', displayName }, content: { type: 'text', text }, metadata }),
  });
  return res.messages?.[0];
}

// Hands the conversation to Agent Workspace so Zendesk creates the ticket.
// dataCapture metadata asks Zendesk to fill ticket fields and tags on the new ticket. Confirm in the spike.
export async function passControl(conversationId: string, metadata: Record<string, string>): Promise<void> {
  await request(`${base()}/conversations/${conversationId}/passControl`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ switchboardIntegration: config.sunshine.switchboardTarget, metadata }),
  });
}

export async function createWebhookIntegration(target: string): Promise<any> {
  const res = await request(`${base()}/integrations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'custom',
      displayName: 'RedChirp Sync',
      webhooks: [{ target, triggers: ['conversation:message'], includeFullUser: true, includeFullSource: true }],
    }),
  });
  return res.integration;
}

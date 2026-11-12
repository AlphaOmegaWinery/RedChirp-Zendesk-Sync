// Spike step 1: sends a test guest text into Zendesk messaging and hands it to Agent Workspace.
// Then reply to the ticket in Zendesk and watch the service logs for the agent reply webhook.
import { config, requireConfig } from '../src/config.js';
import * as sc from '../src/zendesk/sunshine.js';

requireConfig(['ZENDESK_SUBDOMAIN', 'SUNSHINE_APP_ID', 'SUNSHINE_KEY_ID', 'SUNSHINE_SECRET']);
const phone = process.argv[2] ?? '+17075550199';
const externalId = `phone:${phone}`;
const fakeRcConversation = `spike-${Date.now()}`;

const user = await sc.ensureUser(externalId, { givenName: 'Spike', surname: 'Test' });
console.log('User:', user.id, externalId);
const conv = await sc.createConversation(externalId, { redchirpConversationId: fakeRcConversation });
console.log('Conversation:', conv.id);
await sc.postUserMessage(conv.id, externalId, 'Spike test: can I move my tasting to 3pm today?', { origin: 'redchirp-sync', spike: true });
console.log('Posted the guest message.');

const md: Record<string, string> = { 'dataCapture.systemField.tags': 'sms spike' };
if (config.zendesk.rcConversationFieldId) md[`dataCapture.ticketField.${config.zendesk.rcConversationFieldId}`] = fakeRcConversation;
await sc.passControl(conv.id, md);
console.log(`Passed control to "${config.sunshine.switchboardTarget}".`);
console.log(`
Next:
 1. In Zendesk, find the new messaging ticket from "Spike Test". Check it has the tags sms and spike,
    and that the RedChirp conversation field shows ${fakeRcConversation}.
 2. Reply to it as yourself.
 3. Watch the service logs for the reply; then run: npm run spike:ticket -- <ticket id>
`);

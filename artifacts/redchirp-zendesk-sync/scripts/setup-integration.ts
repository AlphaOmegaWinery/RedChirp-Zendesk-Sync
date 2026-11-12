// One-time: registers this service as a custom integration in the Conversations API and prints the webhook secret.
import { config, requireConfig } from '../src/config.js';
import { createWebhookIntegration } from '../src/zendesk/sunshine.js';

requireConfig(['ZENDESK_SUBDOMAIN', 'SUNSHINE_APP_ID', 'SUNSHINE_KEY_ID', 'SUNSHINE_SECRET', 'PUBLIC_URL']);
const target = `${config.publicUrl.replace(/\/$/, '')}/webhooks/conversations`;
const integration = await createWebhookIntegration(target);
const secret = integration?.webhooks?.[0]?.secret;
console.log(`Created integration ${integration?.id} sending conversation:message to ${target}`);
console.log(secret ? `Add this to Replit Secrets as SUNSHINE_WEBHOOK_SECRET:\n${secret}` : JSON.stringify(integration, null, 2));

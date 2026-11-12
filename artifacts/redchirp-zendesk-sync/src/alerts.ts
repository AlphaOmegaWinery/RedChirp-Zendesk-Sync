import { config } from './config.js';
import { log } from './log.js';

// Posts to a Teams channel through a Teams "Workflows" webhook (Post to a channel when a webhook request is received).
export async function alert(title: string, detail: string): Promise<void> {
  log('error', `ALERT: ${title}`, { detail });
  if (!config.teamsWebhookUrl) return;
  const card = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: `RedChirp sync: ${title}`, weight: 'Bolder', wrap: true },
            { type: 'TextBlock', text: detail, wrap: true },
          ],
        },
      },
    ],
  };
  try {
    await fetch(config.teamsWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card) });
  } catch (e) {
    log('error', 'Teams alert failed', { error: String(e) });
  }
}

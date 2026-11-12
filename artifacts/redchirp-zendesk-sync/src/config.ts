// All settings come from Replit Secrets (environment variables). Nothing secret lives in code.
const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;

export const config = {
  port: Number(env('PORT', '3000')),
  // DRY_RUN=true logs every intended write instead of making it. Default is ON until you switch it off.
  dryRun: env('DRY_RUN', 'true') !== 'false',
  publicUrl: env('PUBLIC_URL'), // e.g. https://redchirp-zendesk-sync.yourname.replit.app
  databaseUrl: env('DATABASE_URL'),

  zendesk: {
    subdomain: env('ZENDESK_SUBDOMAIN'), // "alphaomega" for alphaomega.zendesk.com
    email: env('ZENDESK_EMAIL'), // the RedChirp Sync user; system actions only
    apiToken: env('ZENDESK_API_TOKEN'),
    webhookSecret: env('ZENDESK_WEBHOOK_SECRET'), // signing secret of the Zendesk webhook used by triggers
    rcConversationFieldId: env('ZENDESK_RC_CONVERSATION_FIELD_ID'), // ticket field holding the RedChirp conversation ID
    closeReasonFieldId: env('ZENDESK_CLOSE_REASON_FIELD_ID'), // "Close reason" dropdown field
    closeReasonArchivedValue: env('ZENDESK_CLOSE_REASON_ARCHIVED_VALUE', 'archived_in_redchirp'),
  },

  sunshine: {
    appId: env('SUNSHINE_APP_ID'),
    keyId: env('SUNSHINE_KEY_ID'),
    secret: env('SUNSHINE_SECRET'),
    webhookSecret: env('SUNSHINE_WEBHOOK_SECRET'), // printed by `npm run setup:integration`
    // Who takes over the conversation so Zendesk creates a ticket. Confirm in the spike.
    switchboardTarget: env('SUNSHINE_SWITCHBOARD_TARGET', 'next'),
  },

  redchirp: {
    baseUrl: env('REDCHIRP_BASE_URL'),
    organizationId: env('REDCHIRP_ORGANIZATION_ID'),
    credentialId: env('REDCHIRP_CREDENTIAL_ID'),
    apiKey: env('REDCHIRP_API_KEY'),
    privateApiHeader: env('REDCHIRP_PRIVATE_API_HEADER'),
    phoneGroupMap: env('REDCHIRP_PHONE_GROUP_MAP'),
  },

  teamsWebhookUrl: env('TEAMS_WEBHOOK_URL'),

  hours: {
    timezone: 'America/Los_Angeles',
    startHour: Number(env('BUSINESS_START_HOUR', '9')),
    endHour: Number(env('BUSINESS_END_HOUR', '18')),
    pollSecondsBusiness: Number(env('POLL_SECONDS_BUSINESS', '30')),
    pollSecondsAfterHours: Number(env('POLL_SECONDS_AFTER_HOURS', '120')),
  },

  // On a solved ticket, a thanks-only text is logged but not posted, so it does not reopen the ticket.
  skipAckOnlyOnSolved: env('SKIP_ACK_ONLY_ON_SOLVED', 'true') !== 'false',
};

export function requireConfig(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing secrets: ${missing.join(', ')}`);
}

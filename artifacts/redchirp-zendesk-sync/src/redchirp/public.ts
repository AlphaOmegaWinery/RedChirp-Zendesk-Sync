import { config } from '../config.js';
import { basicAuth } from '../http.js';

export type JsonObject = Record<string, unknown>;
export type Fetch = typeof fetch;

export function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`);
  }
  return value as JsonObject;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}: expected a nonempty string`);
  return value;
}

export interface PublicApiOptions {
  baseUrl: string;
  organizationId: string;
  credentialId: string;
  apiKey: string;
}

// One limiter for public RedChirp reads in this process, below the published 15 requests/second.
let nextRequestAt = 0;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + 100;
  await delay(slot - now);
}

export class PublicRedChirpApi {
  readonly organizationId: string;
  private readonly origin: string;
  private readonly prefix: string;
  private readonly authorization: string;

  constructor(
    options: PublicApiOptions = config.redchirp,
    private readonly fetcher: Fetch = fetch,
  ) {
    const base = new URL(text(options.baseUrl, 'REDCHIRP_BASE_URL'));
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
        !['/', '/api/v1', '/api/v1/'].includes(base.pathname)) {
      throw new Error('REDCHIRP_BASE_URL must be an HTTPS origin, optionally ending in /api/v1');
    }
    const organization = text(options.organizationId, 'REDCHIRP_ORGANIZATION_ID');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organization)) {
      throw new Error('REDCHIRP_ORGANIZATION_ID must be a UUID');
    }
    this.origin = base.origin;
    this.organizationId = organization;
    this.prefix = `/api/v1/external/${organization}/`;
    this.authorization = basicAuth(
      text(options.credentialId, 'REDCHIRP_CREDENTIAL_ID'),
      text(options.apiKey, 'REDCHIRP_API_KEY'),
    );
  }

  async list(resource: 'message' | 'employee-account' | 'red-chirp-phone-numbers',
    parameters: Record<string, string> = {}): Promise<JsonObject[]> {
    const first = new URL(`${this.prefix}${resource}`, this.origin);
    first.searchParams.set('page_size', '240');
    for (const [key, value] of Object.entries(parameters)) first.searchParams.set(key, value);
    let next: string | null = first.href;
    const visited = new Set<string>();
    const results: JsonObject[] = [];
    while (next) {
      const url: URL = new URL(next, first);
      if (url.origin !== this.origin || url.pathname !== first.pathname || url.username || url.password || url.hash) {
        throw new Error('Rejected unsafe RedChirp pagination link');
      }
      // Keep the same time window on every page, including links that omit these filters.
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
      if (visited.has(url.href)) throw new Error('RedChirp pagination repeated a page');
      visited.add(url.href);
      const envelope = object(await this.get(url), 'RedChirp response');
      if (envelope.response_type_code !== 'success' || envelope.http_status_code !== 200) {
        throw new Error('RedChirp returned a non-success response envelope');
      }
      const data = object(envelope.response_data, 'RedChirp response_data');
      if (!Array.isArray(data.results)) throw new Error('Invalid RedChirp results array');
      for (const item of data.results) {
        const row = object(item, 'RedChirp result');
        if (row.organization_id !== this.organizationId) throw new Error('RedChirp returned a record from a different organization');
        results.push(row);
      }
      const links = object(data.links, 'RedChirp pagination links');
      const link = links.next_page;
      if (link !== undefined && link !== null && (typeof link !== 'string' || !link)) {
        throw new Error('Invalid RedChirp next_page');
      }
      next = typeof link === 'string' ? link : null;
    }
    return results;
  }

  private async get(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await throttle();
      let response: Response;
      try {
        response = await this.fetcher(url.href, {
          headers: { authorization: this.authorization, accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
          redirect: 'error',
        });
      } catch {
        if (attempt === 3) throw new Error('RedChirp public GET failed after 4 attempts');
        await delay(500 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        try { return await response.json(); }
        catch { throw new Error('RedChirp returned invalid JSON'); }
      }
      // Do not put response bodies, URLs, or authentication into error logs.
      await response.body?.cancel();
      if ((response.status !== 429 && response.status < 500) || attempt === 3) {
        throw new Error(`RedChirp public GET failed (HTTP ${response.status})`);
      }
      const retry = response.headers.get('retry-after');
      const seconds = retry === null ? NaN : Number(retry);
      const time = retry === null ? NaN : Date.parse(retry);
      const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
        : Number.isFinite(time) ? Math.max(0, time - Date.now()) : 500 * 2 ** attempt;
      await delay(wait);
    }
    throw new Error('RedChirp public GET exhausted retries');
  }
}

// fetch with retries for 429 and 5xx, honoring Retry-After.
export class HttpError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 500)}`);
  }
}

export async function request<T = any>(url: string, init: RequestInit = {}, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    const body = await res.text();
    lastErr = new HttpError(res.status, body, url);
    if (res.status !== 429 && res.status < 500) throw lastErr;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** i;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw lastErr;
}

export const basicAuth = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

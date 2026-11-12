import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PublicRedChirpApi, type Fetch, type JsonObject } from '../src/redchirp/public.js';
import { HttpRedChirpClient } from '../src/redchirp/http.js';
import { endpointPhone, loadValidatedPhoneGroupMap, parsePhoneGroupMap, validatePhoneGroupMap } from '../src/redchirp/phone-map.js';
import { planStaffMappings, syncStaffMappings } from '../src/staff-mapping.js';
import { listZendeskStaff } from '../src/zendesk/staff-directory.js';
import { config } from '../src/config.js';

const organizationId = '28df5597-a858-4b43-bbc4-22eba1d9266d';
const options = { baseUrl: 'https://app.redchirp.com/api/v1', organizationId,
  credentialId: 'test-credential', apiKey: 'test-secret-not-a-real-key' };
const response = (results: unknown[], next?: string) => Response.json({
  http_status_code: 200, response_type_code: 'success',
  response_data: { results, links: next ? { next_page: next } : {} },
});
const message = (overrides: JsonObject = {}): JsonObject => ({
  organization_id: organizationId, message_id: 'm1', conversation_id: 'c1',
  author: 'E164:+17075550100', single_endpoint_to: 'E164:+17075550200',
  authored_by_employee_id: null, direction: 'inbound', time: Date.parse('2026-06-02T19:29:00Z'),
  content_type: 'text/plain', content: 'Can I change my tasting?',
  ...overrides,
});
const pollAt = () => new Date('2026-06-02T19:30:00.000Z');
const client = (fetcher: Fetch) => new HttpRedChirpClient(options.baseUrl, options.apiKey,
  new PublicRedChirpApi(options, fetcher), pollAt);

test('public API uses Basic auth, correct base path and no private header', async () => {
  const api = new PublicRedChirpApi(options, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, `/api/v1/external/${organizationId}/employee-account`);
    assert.equal(url.searchParams.get('page_size'), '240');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), `Basic ${Buffer.from('test-credential:test-secret-not-a-real-key').toString('base64')}`);
    assert.equal(headers.has('access-private-api'), false);
    assert.equal(init?.redirect, 'error');
    return response([]);
  });
  await api.list('employee-account');
});

test('all three resources use the exact documented paths and paginated envelopes', async () => {
  const paths: string[] = [];
  const api = new PublicRedChirpApi(options, async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    return response([{ organization_id: organizationId }]);
  });
  for (const resource of ['message', 'employee-account', 'red-chirp-phone-numbers'] as const) await api.list(resource);
  assert.deepEqual(paths, ['message', 'employee-account', 'red-chirp-phone-numbers']
    .map((resource) => `/api/v1/external/${organizationId}/${resource}`));
});

test('every messages page retains fixed bounds, normalizes endpoints, sorts and deduplicates', async () => {
  let calls = 0;
  const c = client(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('time[gte]'), '2026-06-02T19:26:00.000Z');
    assert.equal(url.searchParams.get('time[lte]'), pollAt().toISOString());
    calls++;
    return calls === 1
      ? response([message({ message_id: 'm2', time: Date.parse('2026-06-02T19:29:00Z') })],
        `${options.baseUrl}/external/${organizationId}/message?cursor=page2`)
      : response([message({ time: Date.parse('2026-06-02T19:28:00Z') }),
        message({ message_id: 'm2', time: Date.parse('2026-06-02T19:29:00Z') }),
        message({ message_id: 'm3', direction: 'outbound', time: Date.parse('2026-06-02T19:29:30Z'), authored_by_employee_id: 'employee-1' })]);
  });
  const result = await c.listChangesSince(JSON.stringify({ version: 1, through: '2026-06-02T19:28:00.000Z' }));
  assert.equal(calls, 2);
  assert.deepEqual(result.changes.map((change) => change.changeId), ['message:m1', 'message:m2', 'message:m3']);
  assert.equal(result.changes[0].kind, 'message');
  assert.equal((result.changes[0] as any).phone, '+17075550100');
  assert.equal((result.changes[2] as any).phone, '+17075550200');
  assert.equal((result.changes[2] as any).sentByUserId, 'employee-1');
  assert.deepEqual(JSON.parse(result.nextCursor), { version: 1, through: pollAt().toISOString() });
});

test('published OpenAPI example is accepted without inventing field aliases', async () => {
  const spec = JSON.parse(await readFile(new URL('../docs/redchirp-openapi.json', import.meta.url), 'utf8'));
  const example = spec.paths['/api/v1/external/{organization_id}/message'].get.responses['200']
    .content['application/json'].example;
  const c = new HttpRedChirpClient(options.baseUrl, options.apiKey,
    new PublicRedChirpApi(options, async () => Response.json(example)),
    () => new Date('2026-06-02T21:00:00Z'));
  const result = await c.listChangesSince(null);
  assert.equal(result.changes.length, 3);
  assert.ok(result.changes.every((item) => item.kind === 'message' && item.direction === 'outbound'));
  const first = result.changes[0] as any;
  assert.equal(first.phone, '+12375703352');
  assert.equal(first.sentByUserId, undefined);
});

test('non-text events are explicitly system events, not guest-facing message text', async () => {
  const c = client(async () => response([message({ content_type: 'application/redchirp-note', content: 'Internal note' })]));
  const result = await c.listChangesSince(null);
  assert.equal((result.changes[0] as any).isSystemEvent, true);
  assert.equal((result.changes[0] as any).text, '');
});

test('overlap replay keeps stable event IDs for the unchanged queue deduplication', async () => {
  const c = client(async () => response([message()]));
  const first = await c.listChangesSince(null);
  // The second window includes this message when placed near the cursor boundary.
  const nearBoundary = client(async () => response([message({ time: pollAt().getTime() - 1000 })]));
  const a = await nearBoundary.listChangesSince(null);
  const b = await nearBoundary.listChangesSince(a.nextCursor);
  assert.equal(first.changes[0].changeId, a.changes[0].changeId);
  assert.equal(a.changes[0].changeId, b.changes[0].changeId);
});

test('failed later page rejects the whole poll rather than advancing a cursor', async () => {
  let calls = 0;
  const c = client(async () => ++calls === 1
    ? response([message()], `${options.baseUrl}/external/${organizationId}/message?cursor=next`)
    : new Response('sensitive body must not appear', { status: 403 }));
  await assert.rejects(c.listChangesSince(null), /HTTP 403/);
});

test('unsafe pagination destinations are rejected before credentials can be forwarded', async () => {
  for (const next of [
    'https://evil.example/steal', 'https://app.redchirp.com/api/v1/external/another-org/message',
    `https://user:pass@app.redchirp.com/api/v1/external/${organizationId}/message`,
    `https://app.redchirp.com/api/v1/external/${organizationId}/employee-account`,
  ]) {
    let calls = 0;
    const c = client(async () => { calls++; return response([message()], next); });
    await assert.rejects(c.listChangesSince(null), /unsafe/);
    assert.equal(calls, 1);
  }
});

test('pagination loops fail instead of running forever', async () => {
  const url = `${options.baseUrl}/external/${organizationId}/message?cursor=same`;
  const c = client(async () => response([], url));
  await assert.rejects(c.listChangesSince(null), /repeated a page/);
});

test('HTTP 429 honors Retry-After and retries, but 401 is not retried or leaked', async () => {
  let calls = 0;
  const c = client(async () => ++calls === 1
    ? new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
    : response([message()]));
  assert.equal((await c.listChangesSince(null)).changes.length, 1);
  assert.equal(calls, 2);
  calls = 0;
  const unauthorized = client(async () => { calls++; return new Response('TOP_SECRET', { status: 401 }); });
  await assert.rejects(unauthorized.listChangesSince(null), (error: Error) =>
    error.message.includes('401') && !error.message.includes('TOP_SECRET'));
  assert.equal(calls, 1);
});

test('network errors retry with a bounded attempt count and redact transport errors', async () => {
  let calls = 0;
  const c = client(async () => { calls++; if (calls < 2) throw new Error('secret transport URL'); return response([]); });
  assert.deepEqual((await c.listChangesSince(null)).changes, []);
  assert.equal(calls, 2);
});

test('persistent server failures stop after four attempts', async () => {
  let calls = 0;
  const c = client(async () => {
    calls++;
    return new Response('private error body', { status: 503, headers: { 'retry-after': '0' } });
  });
  await assert.rejects(c.listChangesSince(null), /HTTP 503/);
  assert.equal(calls, 4);
});

test('invalid records and envelopes cannot produce an advanced cursor', async () => {
  for (const override of [
    { direction: 'unknown' }, { time: '2026-06-02' }, { content: null },
    { organization_id: 'another-org' }, { author: 'employee-not-phone' }, { time: pollAt().getTime() + 1 },
  ]) {
    await assert.rejects(client(async () => response([message(override)])).listChangesSince(null));
  }
  await assert.rejects(client(async () => Response.json({ response_data: { results: [] } })).listChangesSince(null));
});

test('invalid/mock/future cursors are rejected before any API request', async () => {
  const c = client(async () => { assert.fail('Must not call API'); });
  for (const cursor of ['0', 'broken', '{}', JSON.stringify({ version: 2, through: pollAt().toISOString() }),
    JSON.stringify({ version: 1, through: '2099-01-01T00:00:00Z' })]) {
    await assert.rejects(c.listChangesSince(cursor));
  }
});

test('private writes fail explicitly without sending any HTTP request', async () => {
  const c = client(async () => { assert.fail('No private API calls are authorized'); });
  await assert.rejects(c.sendMessage({ conversationId: 'c', onBehalfOfUserId: 'e', text: 'hello' }), /BLOCKED/);
  await assert.rejects(c.assign({ conversationId: 'c', userId: 'e' }), /BLOCKED/);
  await assert.rejects(c.archive({ conversationId: 'c' }), /BLOCKED/);
  await assert.rejects(c.unarchive({ conversationId: 'c' }), /BLOCKED/);
});

test('phone mapping is explicit, normalized, and validated against messaging service state', async () => {
  const mapping = parsePhoneGroupMap('{"E164:+17075550100":123}');
  assert.equal(mapping.get('+17075550100'), 123);
  const records = [{ endpoint: 'E164:+17075550100', supports_messaging: true, expected_to_be_in_service: true }];
  validatePhoneGroupMap(records, mapping);
  assert.equal(endpointPhone('+17075550100'), '+17075550100');
  for (const invalid of ['', '{}', '[]', '{"not-a-phone":123}', '{" +17075550100":123}',
    '{"+17075550100":"123"}', '{"+17075550100":0}', '{"+17075550100":1.5}',
    '{"+17075550100":1,"E164:+17075550100":2}']) {
    assert.throws(() => parsePhoneGroupMap(invalid));
  }
  assert.throws(() => validatePhoneGroupMap([], mapping));
  assert.throws(() => validatePhoneGroupMap([{ ...records[0], supports_messaging: false }], mapping));
  assert.throws(() => validatePhoneGroupMap([{ ...records[0], expected_to_be_in_service: false }], mapping));
  const api = new PublicRedChirpApi(options, async () => response(records.map((row) => ({ ...row, organization_id: organizationId }))));
  assert.equal((await loadValidatedPhoneGroupMap(api, '{"+17075550100":123}')).get('+17075550100'), 123);
});

const employee = (overrides: JsonObject = {}): JsonObject => ({
  employee_id: 'e1', username: 'Person@Example.com', is_archived: false, ...overrides,
});
const agent = (overrides: JsonObject = {}): JsonObject => ({
  id: 100, email: 'person@example.com', role: 'agent', suspended: false, ...overrides,
});

test('staff mapping matches exact normalized email, never names or end users', () => {
  const plan = planStaffMappings([employee(), employee({ employee_id: 'e2', username: 'other@example.com' })],
    [agent(), agent({ id: 200, role: 'end-user', email: 'other@example.com' })]);
  assert.deepEqual(plan, {
    updates: [{ redchirp_user_id: 'e1', zendesk_user_id: 100, email: 'person@example.com', active: true }],
    unmatched: 1,
  });
});

test('archived RedChirp employees and suspended Zendesk staff are mapped inactive', () => {
  assert.equal(planStaffMappings([employee({ is_archived: true })], [agent()]).updates[0].active, false);
  assert.equal(planStaffMappings([employee()], [agent({ suspended: true })]).updates[0].active, false);
});

test('ambiguous staff data and existing unique ownership conflicts stop the entire plan', () => {
  assert.throws(() => planStaffMappings([employee()], [agent(), agent({ id: 101 })]), /Ambiguous/);
  assert.throws(() => planStaffMappings([employee(), employee({ employee_id: 'e2' })], [agent()]), /Ambiguous/);
  assert.throws(() => planStaffMappings([employee()], [agent()], [{ redchirp_user_id: 'other', zendesk_user_id: '100' }]), /ownership conflict/);
  assert.throws(() => planStaffMappings([employee({ is_archived: null })], [agent()]));
  assert.throws(() => planStaffMappings([employee()], [agent({ suspended: null })]));
});

test('Zendesk directory follows all pages, filters staff, and never permits off-site pagination', async () => {
  const saved = { ...config.zendesk };
  Object.assign(config.zendesk, { subdomain: 'test-company', email: 'sync@example.com', apiToken: 'test-token' });
  try {
    let calls = 0;
    const users = await listZendeskStaff(async (_url, init) => {
      calls++;
      assert.ok(new Headers(init.headers).get('authorization')?.startsWith('Basic '));
      return calls === 1 ? { users: [agent(), agent({ role: 'end-user' })],
        next_page: 'https://test-company.zendesk.com/api/v2/users.json?page=2' }
        : { users: [agent({ id: 101, email: 'another@example.com' })], next_page: null };
    });
    assert.equal(users.length, 2);
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(listZendeskStaff(async () => {
      calls++;
      return { users: [], next_page: 'https://evil.example/steal' };
    }), /unsafe/);
    assert.equal(calls, 1);
  } finally { Object.assign(config.zendesk, saved); }
});

test('base URL and incomplete live credentials fail closed', () => {
  for (const baseUrl of ['http://app.redchirp.com', 'https://user:pass@app.redchirp.com',
    'https://app.redchirp.com/other', 'https://app.redchirp.com?token=secret']) {
    assert.throws(() => new PublicRedChirpApi({ ...options, baseUrl }));
  }
  assert.throws(() => new PublicRedChirpApi({ ...options, credentialId: '' }));
  assert.throws(() => new PublicRedChirpApi({ ...options, organizationId: 'not-a-uuid' }));
  assert.equal(config.dryRun, process.env.DRY_RUN !== 'false');
});

test('mapping job respects DRY_RUN and uses atomic, repeatable upserts', async () => {
  const api = new PublicRedChirpApi(options, async () => response([
    { ...employee(), organization_id: organizationId },
  ]));
  const statements: string[] = [];
  let releaseCount = 0;
  const database = { connect: async () => ({
    query: async (sql: string) => { statements.push(sql); return { rows: [] }; },
    release: () => { releaseCount++; },
  }) } as any;
  const previous = config.dryRun;
  try {
    config.dryRun = true;
    const dry = await syncStaffMappings(api, async () => [agent()], database);
    assert.equal(dry.planned, 1);
    assert.equal(dry.written, 0);
    assert.ok(!statements.some((sql) => sql.startsWith('INSERT')));
    statements.length = 0;
    config.dryRun = false;
    const real = await syncStaffMappings(api, async () => [agent()], database);
    assert.equal(real.written, 1);
    assert.equal(statements[0], 'BEGIN');
    assert.ok(statements.some((sql) => sql.includes('pg_advisory_xact_lock')));
    assert.ok(statements.some((sql) => sql.includes('ON CONFLICT (redchirp_user_id) DO UPDATE')));
    assert.equal(statements.at(-1), 'COMMIT');
    assert.equal(releaseCount, 2);
  } finally { config.dryRun = previous; }
});

test('mapping job rolls back and releases its database connection on a failed upsert', async () => {
  const api = new PublicRedChirpApi(options, async () => response([
    { ...employee(), organization_id: organizationId },
  ]));
  const statements: string[] = [];
  let released = false;
  const database = { connect: async () => ({
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('INSERT')) throw new Error('database write failed');
      return { rows: [] };
    },
    release: () => { released = true; },
  }) } as any;
  const previous = config.dryRun;
  config.dryRun = false;
  try {
    await assert.rejects(syncStaffMappings(api, async () => [agent()], database), /database write failed/);
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(statements.includes('COMMIT'), false);
    assert.equal(released, true);
  } finally { config.dryRun = previous; }
});

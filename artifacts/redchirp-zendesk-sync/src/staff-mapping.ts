import { config } from './config.js';
import { pool } from './db/index.js';
import { PublicRedChirpApi, text, type JsonObject } from './redchirp/public.js';
import { listZendeskStaff } from './zendesk/staff-directory.js';

type Mapping = { redchirp_user_id: string; zendesk_user_id: number; email: string; active: boolean };
type ExistingMapping = { redchirp_user_id: string; zendesk_user_id: number | string };
const email = (value: unknown): string => {
  const normalized = text(value, 'staff email').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Staff account has no valid email; no mapping was changed');
  return normalized;
};

export function planStaffMappings(employees: JsonObject[], staff: JsonObject[],
  existing: ExistingMapping[] = []): { updates: Mapping[]; unmatched: number } {
  const byEmail = new Map<string, JsonObject>();
  const ids = new Set<number>();
  for (const user of staff) {
    if (user.role !== 'agent' && user.role !== 'admin') continue;
    const address = email(user.email);
    if (byEmail.has(address)) throw new Error('Ambiguous Zendesk staff email; no mapping was changed');
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0 || ids.has(user.id)) {
      throw new Error('Invalid or duplicate Zendesk staff ID');
    }
    if (typeof user.suspended !== 'boolean') throw new Error('Missing Zendesk staff suspended flag');
    ids.add(user.id);
    byEmail.set(address, user);
  }
  const seenEmails = new Set<string>();
  const seenEmployees = new Set<string>();
  const updates: Mapping[] = [];
  let unmatched = 0;
  for (const employee of employees) {
    const rcId = text(employee.employee_id, 'employee_id');
    const address = email(employee.username);
    if (seenEmployees.has(rcId) || seenEmails.has(address)) {
      throw new Error('Ambiguous RedChirp employee account; no mapping was changed');
    }
    if (typeof employee.is_archived !== 'boolean') throw new Error('Missing RedChirp is_archived flag');
    seenEmployees.add(rcId);
    seenEmails.add(address);
    const user = byEmail.get(address);
    if (!user) { unmatched++; continue; }
    const zendeskId = user.id as number;
    if (existing.some((row) => Number(row.zendesk_user_id) === zendeskId && row.redchirp_user_id !== rcId)) {
      throw new Error('Existing user_map ownership conflict; no mapping was changed');
    }
    updates.push({
      redchirp_user_id: rcId, zendesk_user_id: zendeskId, email: address,
      active: !employee.is_archived && !user.suspended,
    });
  }
  return { updates, unmatched };
}

export async function syncStaffMappings(api = new PublicRedChirpApi(),
  staffReader = listZendeskStaff, database = pool): Promise<{ planned: number; written: number; unmatched: number; dryRun: boolean }> {
  // Complete both paginated reads before touching the database.
  const [employees, staff] = await Promise.all([api.list('employee-account'), staffReader()]);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    // Avoid overlapping job runs without a new table or migration.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('redchirp-staff-mapping'))");
    const existing = await client.query<ExistingMapping>('SELECT redchirp_user_id, zendesk_user_id FROM user_map FOR UPDATE');
    const plan = planStaffMappings(employees, staff, existing.rows);
    if (!config.dryRun) {
      for (const row of plan.updates) {
        await client.query(
          `INSERT INTO user_map (redchirp_user_id, zendesk_user_id, email, active)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (redchirp_user_id) DO UPDATE
           SET zendesk_user_id = EXCLUDED.zendesk_user_id, email = EXCLUDED.email, active = EXCLUDED.active`,
          [row.redchirp_user_id, row.zendesk_user_id, row.email, row.active],
        );
      }
    }
    await client.query('COMMIT');
    return { planned: plan.updates.length, written: config.dryRun ? 0 : plan.updates.length,
      unmatched: plan.unmatched, dryRun: config.dryRun };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

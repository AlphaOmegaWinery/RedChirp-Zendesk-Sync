import { requireConfig } from '../src/config.js';
import { pool } from '../src/db/index.js';
import { log } from '../src/log.js';
import { syncStaffMappings } from '../src/staff-mapping.js';

try {
  requireConfig(['DATABASE_URL']);
  log('info', 'Staff mapping job finished', await syncStaffMappings());
} catch (error) {
  log('error', 'Staff mapping job failed', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exitCode = 1;
} finally {
  await pool.end();
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './index.js';

// Works from both `tsx src/db/migrate.ts` and the compiled build, since it reads from the project root.
const sql = await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8');
await pool.query(sql);
console.log('Database schema is up to date.');
await pool.end();

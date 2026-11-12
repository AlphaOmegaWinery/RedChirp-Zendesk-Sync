import { config } from '../config.js';
import { object, text, type JsonObject, PublicRedChirpApi } from './public.js';

export function endpointPhone(value: unknown): string {
  const phone = text(value, 'RedChirp phone endpoint').replace(/^E164:/, '');
  if (!/^\+[1-9]\d{1,14}$/.test(phone)) throw new Error('Expected an E.164 phone endpoint');
  return phone;
}

export function parsePhoneGroupMap(raw = config.redchirp.phoneGroupMap): ReadonlyMap<string, number> {
  if (!raw) throw new Error('REDCHIRP_PHONE_GROUP_MAP is required; group assignments are never inferred');
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch { throw new Error('Invalid REDCHIRP_PHONE_GROUP_MAP JSON'); }
  const entries = object(decoded, 'REDCHIRP_PHONE_GROUP_MAP');
  const result = new Map<string, number>();
  for (const [key, group] of Object.entries(entries)) {
    const phone = endpointPhone(key);
    if (typeof group !== 'number' || !Number.isSafeInteger(group) || group <= 0) {
      throw new Error('Each phone mapping must contain a positive safe-integer Zendesk group ID');
    }
    if (result.has(phone)) throw new Error('Duplicate normalized phone in REDCHIRP_PHONE_GROUP_MAP');
    result.set(phone, group);
  }
  if (!result.size) throw new Error('REDCHIRP_PHONE_GROUP_MAP must explicitly map at least one number');
  return result;
}

export function validatePhoneGroupMap(numbers: JsonObject[], mapping: ReadonlyMap<string, number>): void {
  const available = new Map<string, JsonObject>();
  for (const row of numbers) {
    const phone = endpointPhone(row.endpoint);
    if (available.has(phone)) throw new Error('RedChirp returned duplicate phone records');
    available.set(phone, row);
  }
  for (const phone of mapping.keys()) {
    const row = available.get(phone);
    if (!row) throw new Error('A mapped number is not present in the RedChirp organization');
    if (row.supports_messaging !== true || row.expected_to_be_in_service !== true) {
      throw new Error('A mapped RedChirp number is not in service for messaging');
    }
  }
}

export async function loadValidatedPhoneGroupMap(api = new PublicRedChirpApi(),
  raw = config.redchirp.phoneGroupMap): Promise<ReadonlyMap<string, number>> {
  const mapping = parsePhoneGroupMap(raw);
  const numbers = await api.list('red-chirp-phone-numbers');
  validatePhoneGroupMap(numbers, mapping);
  return mapping;
}

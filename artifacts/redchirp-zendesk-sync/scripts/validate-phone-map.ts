import { loadValidatedPhoneGroupMap } from '../src/redchirp/phone-map.js';
import { log } from '../src/log.js';

try {
  const mapping = await loadValidatedPhoneGroupMap();
  log('info', 'Phone mapping validated against RedChirp', { mappedNumbers: mapping.size });
} catch (error) {
  // Invalid JSON may contain settings; never print its parse error or the map itself.
  log('error', 'Phone mapping validation failed', {
    error: error instanceof SyntaxError ? 'Invalid REDCHIRP_PHONE_GROUP_MAP JSON'
      : error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
}

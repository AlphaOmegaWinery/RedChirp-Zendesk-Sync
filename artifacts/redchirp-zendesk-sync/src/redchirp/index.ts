import { config } from '../config.js';
import { HttpRedChirpClient } from './http.js';
import { MockRedChirpClient } from './mock.js';
import type { RedChirpClient } from './types.js';

// A partially configured live connection must fail, not silently fall back to mock data.
export const usingMock = ![
  config.redchirp.baseUrl, config.redchirp.organizationId, config.redchirp.credentialId, config.redchirp.apiKey,
].some(Boolean);
export const mockRedChirp = new MockRedChirpClient();
export const redchirp: RedChirpClient = usingMock ? mockRedChirp : new HttpRedChirpClient();

/**
 * OFFLINE-06 — tokenStore.ts's IndexedDB token mirror, the side channel the service
 * worker reads from since it has no localStorage access.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { mirrorTokens, clearMirroredTokens, getMirroredTokens } from '../tokenStore.js';

beforeEach(async () => {
  await db.authTokens.clear();
});

describe('tokenStore', () => {
  it('mirrorTokens stores both tokens, retrievable via getMirroredTokens', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    expect(await getMirroredTokens()).toEqual({ id: 'current', accessToken: 'access-1', refreshToken: 'refresh-1' });
  });

  it('a later mirrorTokens call overwrites the previous pair (single fixed-key row)', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    await mirrorTokens('access-2', 'refresh-2');
    expect(await getMirroredTokens()).toEqual({ id: 'current', accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('clearMirroredTokens removes the stored pair', async () => {
    await mirrorTokens('access-1', 'refresh-1');
    await clearMirroredTokens();
    expect(await getMirroredTokens()).toBeUndefined();
  });

  it('returns undefined when nothing has ever been mirrored', async () => {
    expect(await getMirroredTokens()).toBeUndefined();
  });
});

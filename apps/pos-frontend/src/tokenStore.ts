// OFFLINE-06: mirrors auth.ts's localStorage tokens into IndexedDB so the service worker's
// Background Sync handler (sw.ts / swSync.ts) can authenticate without DOM access. This is a
// best-effort side channel — page-context auth (auth.ts) keeps localStorage as its source of
// truth and works exactly as before regardless of whether this mirror succeeds.
import { db } from './db.js';

const RECORD_ID = 'current' as const;

export async function mirrorTokens(accessToken: string, refreshToken: string): Promise<void> {
  try {
    await db.authTokens.put({ id: RECORD_ID, accessToken, refreshToken });
  } catch {
    // best-effort — a failed mirror only means a background sync attempt has to wait for
    // the next tab-open sync instead of running while the tab is closed
  }
}

export async function clearMirroredTokens(): Promise<void> {
  try {
    await db.authTokens.delete(RECORD_ID);
  } catch {
    // best-effort, see mirrorTokens
  }
}

export async function getMirroredTokens(): Promise<{ accessToken: string; refreshToken: string } | undefined> {
  return db.authTokens.get(RECORD_ID);
}

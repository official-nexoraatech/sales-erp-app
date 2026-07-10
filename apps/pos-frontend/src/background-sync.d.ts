// Ambient types for the Background Sync API, which TypeScript's shipped DOM/webworker libs
// don't define. Kept minimal — only the members this app actually calls/handles.
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly sync: SyncManager;
}

// Pluggable analytics abstraction for the public marketing pages. No provider is wired up by
// default (no GA/Clarity/Segment/Mixpanel key exists in this codebase) — swap in a real
// provider by calling setAnalyticsProvider() once at app startup, e.g. in main.tsx, without
// touching any call site of trackEvent().
export interface AnalyticsProvider {
  track: (event: string, properties?: Record<string, unknown>) => void;
  page: (path: string) => void;
}

const noopProvider: AnalyticsProvider = {
  track: () => {},
  page: () => {},
};

let activeProvider: AnalyticsProvider = noopProvider;

export function setAnalyticsProvider(provider: AnalyticsProvider): void {
  activeProvider = provider;
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  activeProvider.track(event, properties);
}

export function trackPageView(path: string): void {
  activeProvider.page(path);
}

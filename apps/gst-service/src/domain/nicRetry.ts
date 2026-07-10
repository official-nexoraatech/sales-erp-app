// Shared retry helper for NIC IRP/e-Way Bill HTTP calls.
// Retries transient failures (network errors, 429, 5xx) up to `maxAttempts` times
// with exponential backoff (1s / 2s / 4s). Non-transient responses (2xx, 4xx business
// errors) are returned immediately on the first attempt.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      const isTransient = response.status === 429 || response.status >= 500;
      if (!isTransient || attempt === maxAttempts - 1) {
        return response;
      }
      await sleep(2 ** attempt * 1000);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts - 1) throw err;
      await sleep(2 ** attempt * 1000);
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

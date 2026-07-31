import { useEffect, useState } from 'react';

/** Turns a fetched Blob (from apiClient.getBlob — endpoints that require an Authorization
 * header, so a plain <img src> can't be pointed at them directly) into an object: URL usable
 * as an <img src>, revoking it on unmount/change to avoid leaking memory. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

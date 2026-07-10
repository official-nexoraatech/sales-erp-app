import { searchApi } from '../api/endpoints.js';
import type { AsyncSelectOption } from '../components/erp/ERPAsyncSelect.js';
import { getSearchResultTitle, getSearchResultSubtitle } from './searchEntityConfig.js';

// Feeds ERPAsyncSelect's `loadOptions` prop from the global search endpoint instead of a
// full unbounded list fetch — for entities with potentially thousands of rows (customers,
// suppliers, items, employees), loading every row into the browser just to populate a
// dropdown doesn't scale. Small, fixed-size lists (branches, warehouses, units) aren't this
// problem and are left as plain <Select> fed by their existing list APIs.
export function createSearchLoadOptions(entity: string): (query: string) => Promise<AsyncSelectOption[]> {
  return async (query: string) => {
    const result = await searchApi.search({ q: query, entity, size: 20 });
    return result.hits.map((hit) => {
      const sublabel = getSearchResultSubtitle(hit);
      return {
        value: hit.id,
        label: getSearchResultTitle(hit),
        ...(sublabel !== undefined ? { sublabel } : {}),
      };
    });
  };
}

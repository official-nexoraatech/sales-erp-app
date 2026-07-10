import { describe, it, expect, vi } from 'vitest';
import { createSearchLoadOptions } from '../searchSelectOptions.js';

const searchMock = vi.fn();

vi.mock('../../api/endpoints.js', () => ({
  searchApi: { search: (...args: unknown[]) => searchMock(...args) },
}));

describe('createSearchLoadOptions', () => {
  it('queries the given entity and maps hits to {value, label, sublabel}', async () => {
    searchMock.mockResolvedValue({
      hits: [{ id: '7', entity: 'customer', score: 1, source: { name: 'Ramesh Textiles', phone: '9999999999' } }],
      total: 1, took: 1, query: 'ramesh',
    });

    const loadOptions = createSearchLoadOptions('customer');
    const options = await loadOptions('ramesh');

    expect(searchMock).toHaveBeenCalledWith({ q: 'ramesh', entity: 'customer', size: 20 });
    expect(options).toEqual([{ value: '7', label: 'Ramesh Textiles', sublabel: '9999999999' }]);
  });

  it('omits sublabel entirely (not undefined) when there is nothing to show', async () => {
    searchMock.mockResolvedValue({
      hits: [{ id: '3', entity: 'supplier', score: 1, source: { name: 'Textile Mills' } }],
      total: 1, took: 1, query: 'textile',
    });

    const options = await createSearchLoadOptions('supplier')('textile');

    expect(options[0]).toEqual({ value: '3', label: 'Textile Mills' });
    expect(options[0]).not.toHaveProperty('sublabel');
  });
});

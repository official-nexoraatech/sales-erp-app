/** @deprecated Use ERPDataGrid from components/erp instead. */

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  keyField?: keyof T;
  loading?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
}

export default function DataTable<T extends object>({
  columns,
  data,
  keyField = 'id' as keyof T,
  loading,
  isLoading,
  emptyMessage = 'No records found.',
}: Props<T>) {
  const showLoading = loading ?? isLoading;
  return (
    <div className="rounded-xl border border-default overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-surface-subtle border-b border-default">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-semibold text-xs text-secondary uppercase tracking-wide ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-default">
          {showLoading ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-10 text-disabled">
                Loading…
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-10 text-disabled">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={String((row as Record<string, unknown>)[keyField as string])}
                className="bg-surface-card hover:bg-surface-subtle dark:hover:bg-gray-750 transition-colors"
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-primary ${col.className ?? ''}`}>
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

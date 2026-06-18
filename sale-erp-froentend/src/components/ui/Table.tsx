import React from 'react';
export interface TableColumn<T> {
  key: keyof T | string;
  header: string;
  render?: (value: any, record: T) => React.ReactNode;
  width?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps<any>>(
  (
    {
      columns,
      data,
      isLoading = false,
      emptyMessage = 'No data available',
      className,
    },
    ref
  ) => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-8">
          <div className="text-gray-500">Loading...</div>
        </div>
      );
    }

    if (data.length === 0) {
      return (
        <div className="flex justify-center py-8">
          <div className="text-gray-500">{emptyMessage}</div>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table
          ref={ref}
          className={`w-full text-sm ${className || ''}`}
        >
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className="px-6 py-3 text-left font-semibold text-gray-900"
                  style={{ width: col.width }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((record, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {columns.map((col, colIdx) => (
                  <td key={colIdx} className="px-6 py-4">
                    {col.render
                      ? col.render(record[col.key as string], record)
                      : record[col.key as string]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
);

Table.displayName = 'Table';

import React from 'react';
import { Table } from '../ui/Table';
import type { TableColumn } from '../ui/Table';
import { Pagination } from '../ui/Pagination';
import { SearchBox } from './SearchBox';
import { Loader } from '../ui/Loader';

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  isLoading: boolean;
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
}

export const DataTable = React.forwardRef<HTMLTableElement, DataTableProps<any>>(
  (
    {
      columns,
      data,
      isLoading,
      totalPages,
      currentPage,
      onPageChange,
      searchValue,
      onSearchChange,
      searchPlaceholder = 'Search...',
    },
    ref
  ) => {
    return (
      <div className="space-y-4">
        <SearchBox
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={onSearchChange}
        />

        <div className="bg-white rounded-lg shadow">
          {isLoading ? (
            <div className="p-8">
              <Loader size="md" />
            </div>
          ) : (
            <Table ref={ref} columns={columns} data={data} />
          )}
        </div>

        {data.length > 0 && (
          <div className="flex justify-end">
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          </div>
        )}
      </div>
    );
  }
);

DataTable.displayName = 'DataTable';

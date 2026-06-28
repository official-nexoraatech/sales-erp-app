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
  toolbar?: React.ReactNode;
  headerContent?: React.ReactNode;
  emptyMessage?: string;
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
      toolbar,
      headerContent,
      emptyMessage,
    },
    ref,
  ) => (
    <div className="space-y-3">
      {/* Search + toolbar row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <SearchBox
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={onSearchChange}
          />
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      {headerContent && <div>{headerContent}</div>}

      {/* Table card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 shadow-sm dark:shadow-slate-900/40">
        {isLoading ? (
          <div className="py-10">
            <Loader size="md" />
          </div>
        ) : (
          <Table
            ref={ref}
            columns={columns}
            data={data}
            emptyMessage={emptyMessage}
          />
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-end pt-1">
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={onPageChange}
            showPageNumbers={totalPages <= 10}
          />
        </div>
      )}
    </div>
  ),
);

DataTable.displayName = 'DataTable';

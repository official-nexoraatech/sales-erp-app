import { useState } from 'react';

interface UsePaginationProps {
  initialPage?: number;
  pageSize?: number;
}

export const usePagination = ({
  initialPage = 0,
  pageSize = 10,
}: UsePaginationProps = {}) => {
  const [page, setPage] = useState(initialPage);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handlePreviousPage = () => {
    if (page > 0) {
      setPage(page - 1);
    }
  };

  const handleNextPage = () => {
    setPage(page + 1);
  };

  return {
    page,
    pageSize,
    setPage,
    handlePageChange,
    handlePreviousPage,
    handleNextPage,
  };
};

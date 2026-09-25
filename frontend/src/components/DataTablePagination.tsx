import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

export interface DataTablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZES = [10, 25, 50];

function getVisiblePages(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, currentPage]);

  const windowStart = Math.max(2, currentPage - 1);
  const windowEnd = Math.min(totalPages - 1, currentPage + 1);

  for (let page = windowStart; page <= windowEnd; page += 1) {
    pages.add(page);
  }

  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
  }

  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
  }

  return Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

export function DataTablePagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const safeTotalPages = Math.max(1, totalPages || 1);
  const visiblePages = useMemo(
    () => getVisiblePages(currentPage, safeTotalPages),
    [currentPage, safeTotalPages]
  );

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="data-table-pagination">
      <div className="data-table-pagination__left">
        <label className="data-table-pagination__rows-per-page">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <span className="data-table-pagination__summary">
          {totalItems === 0
            ? 'No results'
            : `Showing ${startItem}–${endItem} of ${totalItems} results`}
        </span>
      </div>

      <div className="data-table-pagination__right">
        <button
          type="button"
          className="data-table-pagination__nav"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1 || safeTotalPages <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="data-table-pagination__numbers" aria-label="Pagination page numbers">
          {visiblePages.map((page) => {
            const isCurrent = page === currentPage;
            return (
              <button
                key={page}
                type="button"
                className={`data-table-pagination__page ${isCurrent ? 'is-active' : ''}`}
                onClick={() => onPageChange(page)}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={`Go to page ${page}`}
                disabled={isCurrent}
              >
                {page}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="data-table-pagination__nav"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= safeTotalPages || safeTotalPages <= 1}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export function ERPTableSkeleton({ rows = 5, cols = 5 }: TableSkeletonProps) {
  return (
    <div className="w-full">
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex items-center gap-4 px-4 py-3 border-b border-default">
          {Array.from({ length: cols }).map((_, ci) => (
            <div
              key={ci}
              className={`h-4 rounded bg-surface-raised animate-pulse ${
                ci === 0 ? 'w-16' : ci === cols - 1 ? 'w-12' : 'flex-1'
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ERPFormSkeleton() {
  return (
    <div className="space-y-6 p-6 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-24 bg-surface-raised rounded" />
          <div className="h-9 w-full bg-surface-raised rounded-lg" />
        </div>
      ))}
      <div className="flex gap-3 pt-4">
        <div className="h-9 w-20 bg-surface-raised rounded-lg" />
        <div className="h-9 w-28 bg-primary/20 rounded-lg" />
      </div>
    </div>
  );
}

export function ERPCardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-3 animate-pulse">
      <div className="h-4 w-1/3 bg-surface-raised rounded" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 bg-surface-raised rounded ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function ERPDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-surface-raised rounded" />
          <div className="h-4 w-32 bg-surface-raised rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-surface-raised rounded-lg" />
          <div className="h-9 w-28 bg-primary/20 rounded-lg" />
        </div>
      </div>

      {/* KPI row skeleton */}
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-card rounded-xl border border-default p-4 space-y-2">
            <div className="h-3 w-16 bg-surface-raised rounded" />
            <div className="h-6 w-24 bg-surface-raised rounded" />
          </div>
        ))}
      </div>

      {/* Content area skeleton */}
      <div className="bg-surface-card rounded-xl border border-default p-6">
        <ERPTableSkeleton rows={6} cols={5} />
      </div>
    </div>
  );
}

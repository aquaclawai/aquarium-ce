import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}

const CELL_WIDTHS = ["70%", "85%", "60%", "50%", "75%", "90%", "65%", "80%"];

export function TableSkeleton({ rows = 5, columns = 4, showHeader = true }: TableSkeletonProps) {
  const [rowWidths] = React.useState(() =>
    Array.from({ length: rows }, () =>
      Array.from({ length: columns }, (_, c) => CELL_WIDTHS[(c + Math.floor(Math.random() * 4)) % CELL_WIDTHS.length])
    )
  );

  return (
    <div className="w-full space-y-2">
      {showHeader && (
        <div className="flex gap-4 border-b border-border pb-3">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}
      {rowWidths.map((cellWidths, r) => (
        <div key={r} className="flex gap-4 py-2">
          {cellWidths.map((w, c) => (
            <div key={c} className="flex-1">
              <Skeleton className="h-4" style={{ width: w }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

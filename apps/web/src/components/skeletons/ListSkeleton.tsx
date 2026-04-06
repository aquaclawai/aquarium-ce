import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface ListSkeletonProps {
  rows?: number;
  showIcon?: boolean;
  showAction?: boolean;
}

const TEXT_WIDTHS = ["75%", "60%", "85%", "50%", "70%", "65%", "80%", "55%"];

export function ListSkeleton({ rows = 5, showIcon = false, showAction = false }: ListSkeletonProps) {
  const [widths] = React.useState(() =>
    Array.from({ length: rows }, (_, i) => TEXT_WIDTHS[i % TEXT_WIDTHS.length])
  );

  return (
    <div className="space-y-3">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          {showIcon && <Skeleton className="size-8 shrink-0 rounded-md" />}
          <Skeleton className="h-4 flex-1" style={{ maxWidth: w }} />
          {showAction && <Skeleton className="h-6 w-16 shrink-0 rounded-md" />}
        </div>
      ))}
    </div>
  );
}

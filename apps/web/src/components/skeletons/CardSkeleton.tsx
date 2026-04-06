import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface CardSkeletonProps {
  lines?: number;
  showBadge?: boolean;
  showAction?: boolean;
}

const LINE_WIDTHS = ["85%", "72%", "60%", "90%", "55%", "78%", "65%", "80%"];

export function CardSkeleton({ lines = 3, showBadge = false, showAction = false }: CardSkeletonProps) {
  const [widths] = React.useState(() =>
    Array.from({ length: lines }, (_, i) => LINE_WIDTHS[i % LINE_WIDTHS.length])
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-36" />
        {showBadge && <Skeleton className="h-5 w-16 rounded-full" />}
      </div>
      {widths.map((w, i) => (
        <Skeleton key={i} className="h-4" style={{ width: w }} />
      ))}
      {showAction && (
        <div className="pt-2">
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      )}
    </div>
  );
}

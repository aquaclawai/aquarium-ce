import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface TabsSkeletonProps {
  count?: number;
}

const TAB_WIDTHS = [72, 88, 64, 80, 96, 68];

export function TabsSkeleton({ count = 4 }: TabsSkeletonProps) {
  const [widths] = React.useState(() =>
    Array.from({ length: count }, (_, i) => TAB_WIDTHS[i % TAB_WIDTHS.length])
  );

  return (
    <div className="flex gap-2 border-b border-border pb-2 mb-4">
      {widths.map((w, i) => (
        <Skeleton key={i} className="h-8 rounded-md" style={{ width: `${w}px` }} />
      ))}
    </div>
  );
}

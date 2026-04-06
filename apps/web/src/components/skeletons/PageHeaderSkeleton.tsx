import { Skeleton } from "@/components/ui/skeleton";

interface PageHeaderSkeletonProps {
  showAction?: boolean;
}

export function PageHeaderSkeleton({ showAction = true }: PageHeaderSkeletonProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {showAction && (
        <div className="page-header__action">
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      )}
    </header>
  );
}

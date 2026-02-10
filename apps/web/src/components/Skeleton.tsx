interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton ${className}`} />;
}

export function AgentCardSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <Skeleton className="h-32 w-full !rounded-none" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <Skeleton className="h-3 w-16 mb-2" />
      <Skeleton className="h-6 w-24" />
    </div>
  );
}

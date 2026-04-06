import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', background: 'var(--color-bg)' }}>
        {/* Sidebar placeholder */}
        <div style={{ width: 256, borderRight: '1px solid var(--color-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton className="h-8 w-32 rounded-md" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {[75, 60, 85, 70, 55].map((w, i) => (
              <Skeleton key={i} className="h-8 rounded-md" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
        {/* Content area placeholder */}
        <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-4 w-72 rounded-md" />
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 flex-1 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

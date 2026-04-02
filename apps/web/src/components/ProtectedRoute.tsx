import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const isEE = import.meta.env.VITE_EDITION !== 'ce';

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  // CE mode: no authentication — always render content
  if (!isEE) {
    return <Outlet />;
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

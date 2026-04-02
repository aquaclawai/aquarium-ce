/**
 * TestAuthProvider — drop-in replacement for Clerk-backed AuthProvider.
 *
 * Used ONLY when VITE_CLERK_PUBLISHABLE_KEY is absent (CI / test mode).
 * Reads the `token` cookie set by the test-signup / test-login endpoints,
 * calls GET /api/auth/me to hydrate user state, and provides values into
 * the same AuthContext that the rest of the app uses via useAuth().
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@aquarium/shared';
import { AuthContext } from './AuthContext';
import { api } from '../api';

export function TestAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ user: User }>('/auth/me');
        if (!cancelled) {
          setUser(res.user);
          userRef.current = res.user;
          try {
            await api.get<{ isAdmin: boolean }>('/admin/check');
            if (!cancelled) setIsAdmin(true);
          } catch {
            if (!cancelled) setIsAdmin(false);
          }
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          userRef.current = null;
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      setUser(null);
      userRef.current = null;
      setIsAdmin(false);
    }
  }, []);

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser(prev => {
      const updated = prev ? { ...prev, ...partial } : prev;
      userRef.current = updated;
      return updated;
    });
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    return userRef.current ? `test:${userRef.current.id}` : null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAdmin, logout, updateUser, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

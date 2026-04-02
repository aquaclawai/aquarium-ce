/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useUser, useAuth as useClerkAuth, useClerk } from '@clerk/clerk-react';
import type { User } from '@aquarium/shared';
import { api, setTokenGetter } from '../api';

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  logout: () => Promise<void>;
  updateUser: (partial: Partial<User>) => void;
  getToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn, user: clerkUser } = useUser();
  const { getToken } = useClerkAuth();
  const clerk = useClerk();

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Wire Clerk's getToken into the api module so all API calls include the Bearer token
  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  // When Clerk says we're signed in, fetch local user data from /api/auth/me
  useEffect(() => {
    if (!clerkLoaded) return;

    if (!isSignedIn) {
      setUser(null);
      setIsAdmin(false);
      setIsLoading(false);
      return;
    }

    // Clerk user is authenticated — sync with our backend
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const res = await api.get<{ user: User }>('/auth/me');
        if (!cancelled) {
          setUser(res.user);
          // Check admin status
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
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [clerkLoaded, isSignedIn, clerkUser?.id]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      await clerk.signOut();
      setUser(null);
      setIsAdmin(false);
    }
  }, [clerk]);

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...partial } : prev);
  }, []);

  const getTokenFn = useCallback(() => getToken(), [getToken]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAdmin, logout, updateUser, getToken: getTokenFn }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

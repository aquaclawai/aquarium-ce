import type { ReactNode } from 'react';
import type { User } from '@aquarium/shared';
import { AuthContext } from './AuthContext';
import type { AuthContextType } from './AuthContext';

const CE_USER: User = {
  id: 'ce-admin',
  email: 'admin@localhost',
  displayName: 'Admin',
  role: 'admin',
  billingMode: 'byok',
  usageBalanceUsd: null,
  usageLimitUsd: null,
  createdAt: new Date(0).toISOString(),
};

const CE_AUTH_VALUE: AuthContextType = {
  user: CE_USER,
  isLoading: false,
  isAdmin: true,
  logout: async () => {
    // CE has no auth — no-op
  },
  updateUser: () => {
    // CE user is static — no-op
  },
  getToken: async () => 'ce-admin',
};

export function CeAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={CE_AUTH_VALUE}>
      {children}
    </AuthContext.Provider>
  );
}

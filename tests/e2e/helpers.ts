import { expect, type APIRequestContext } from '@playwright/test';

export const API = 'http://localhost:3001/api';
export const BASE = 'http://localhost:5173';

export function uniqueEmail(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

export async function signup(
  request: APIRequestContext,
  overrides?: { email?: string; password?: string; displayName?: string },
) {
  const email = overrides?.email ?? uniqueEmail();
  const password = overrides?.password ?? 'TestPass123!';
  const displayName = overrides?.displayName ?? 'E2E User';
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email, password, displayName },
  });
  return { res, email, password, displayName };
}

export async function signupAndGetCookie(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const password = 'TestPass123!';
  const displayName = 'E2E User';
  const token = await signupWithFallback(request, email, password, displayName);
  return `token=${token}`;
}

export async function signupWithCredentials(request: APIRequestContext): Promise<{
  email: string;
  password: string;
  cookie: string;
}> {
  const email = uniqueEmail();
  const password = 'TestPass123!';
  const displayName = 'E2E User';
  const token = await signupWithFallback(request, email, password, displayName);
  return { email, password, cookie: `token=${token}` };
}

export async function signupWithFallback(
  request: APIRequestContext,
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const signupRes = await request.post(`${API}/auth/test-signup`, {
      data: { email, password, displayName },
    });
    
    if (signupRes.ok()) {
      const setCookie = signupRes.headers()['set-cookie'];
      const match = setCookie?.match(/token=([^;]+)/);
      if (match?.[1]) return match[1];
    }
    
    if (signupRes.status() === 409) {
      const loginRes = await request.post(`${API}/auth/test-login`, {
        data: { email, password },
      });
      if (loginRes.ok()) {
        const setCookie = loginRes.headers()['set-cookie'];
        const match = setCookie?.match(/token=([^;]+)/);
        if (match?.[1]) return match[1];
      }
      if (loginRes.status() === 429) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }
    
    if (signupRes.status() === 429) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    
    const loginRes = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    if (loginRes.ok()) {
      const setCookie = loginRes.headers()['set-cookie'];
      const match = setCookie?.match(/token=([^;]+)/);
      if (match?.[1]) return match[1];
    }
    if (loginRes.status() === 429) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
  }
  throw new Error(`Failed to signup/login for ${email} after 5 attempts`);
}

/**
 * Login an existing user and return the auth cookie
 */
export async function loginAndGetCookie(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    if (res.ok()) {
      const setCookie = res.headers()['set-cookie'];
      const match = setCookie?.match(/token=([^;]+)/);
      if (match?.[1]) return `token=${match[1]}`;
    }
    if (res.status() === 429) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    throw new Error(`Login failed for ${email}: ${res.status()}`);
  }
  throw new Error(`Login failed for ${email} after 5 attempts (rate limited)`);
}

/**
 * Create a user credential via API
 */
export async function createCredential(
  request: APIRequestContext,
  cookie: string,
  data: {
    provider: string;
    credentialType: string;
    value: string;
    displayName?: string;
    role?: string;
  },
): Promise<{ id: string; provider: string; credentialType: string }> {
  const res = await request.post(`${API}/credentials`, {
    headers: { Cookie: cookie },
    data,
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  return json.data;
}

/**
 * Set user budget via API
 */
export async function setBudget(
  request: APIRequestContext,
  cookie: string,
  data: {
    monthlyBudgetCny?: number;
    annualBudgetCny?: number;
    alertThresholdPercent?: number;
    alertEnabled?: boolean;
  },
): Promise<void> {
  const res = await request.put(`${API}/budgets`, {
    headers: { Cookie: cookie },
    data,
  });
  expect(res.ok()).toBeTruthy();
}

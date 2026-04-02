import type { ApiResponse } from '@aquarium/shared';

const API_BASE = '/api';

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

export class ApiError extends Error {
  public status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = 'An error occurred';
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      errorMessage = response.statusText;
    }
    throw new ApiError(errorMessage, response.status);
  }

  const data: ApiResponse<T> = await response.json();
  if (!data.ok) {
    throw new ApiError(data.error || 'API response not ok');
  }
  return data.data as T;
}

export const api = {
  get: async <T>(url: string): Promise<T> => {
    const headers = await getHeaders();
    const response = await fetch(`${API_BASE}${url}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    return handleResponse<T>(response);
  },

  post: async <T>(url: string, body?: unknown): Promise<T> => {
    const headers = await getHeaders();
    const response = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    return handleResponse<T>(response);
  },

  delete: async <T>(url: string): Promise<T> => {
    const headers = await getHeaders();
    const response = await fetch(`${API_BASE}${url}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });
    return handleResponse<T>(response);
  },

  patch: async <T>(url: string, body?: unknown): Promise<T> => {
    const headers = await getHeaders();
    const response = await fetch(`${API_BASE}${url}`, {
      method: 'PATCH',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    return handleResponse<T>(response);
  },

  put: async <T>(url: string, body?: unknown): Promise<T> => {
    const headers = await getHeaders();
    const response = await fetch(`${API_BASE}${url}`, {
      method: 'PUT',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    return handleResponse<T>(response);
  },

  uploadFile: async (instanceId: string, fileName: string, content: string, mimeType: string): Promise<{ path: string }> => {
    const headers = await getHeaders();
    const response = await fetch(`${API_BASE}/instances/${instanceId}/files/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName, content, mimeType }),
      credentials: 'include',
    });
    return handleResponse<{ path: string }>(response);
  },
};

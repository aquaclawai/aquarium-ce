import { api } from '../api.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(
  instanceId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return api.post<T>(`/instances/${instanceId}/rpc`, { method, params });
}

/**
 * CE stub — LiteLLM key management is an EE-only feature.
 * These methods are no-ops in CE mode; platform billing mode is disabled.
 */
export const litellmKeyManager = {
  async createKeyForInstance(_params: { instanceId: string; userId: string; userEmail: string }): Promise<{ virtualKey: string }> {
    return { virtualKey: '' };
  },
  async revokeKeyForInstance(_instanceId: string): Promise<void> {
    // no-op in CE
  },
  async syncUserBudgetToTeam(_userId: string, _usageLimitUsd: number | null): Promise<void> {
    // no-op in CE
  },
};

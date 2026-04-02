import type { RegisteredAgentType } from './types.js';
import { openclawManifest, openclawAdapter } from './openclaw/index.js';
import { claudeCodeManifest } from './claude-code/index.js';
import { opencodeManifest } from './opencode/index.js';

const registry = new Map<string, RegisteredAgentType>();

registry.set('openclaw', {
  manifest: openclawManifest,
  adapter: openclawAdapter,
});

registry.set('claude-code', {
  manifest: claudeCodeManifest,
});

registry.set('opencode', {
  manifest: opencodeManifest,
});

export function getAgentType(id: string): RegisteredAgentType {
  const agentType = registry.get(id);
  if (!agentType) throw new Error(`Unknown agent type: ${id}`);
  return agentType;
}

export function listAgentTypes(): RegisteredAgentType[] {
  return Array.from(registry.values());
}

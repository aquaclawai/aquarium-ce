import type { DlpConfig, DlpMode, OutputFilterCategory, OutputFilterMatch, OutputFilterResult } from '@aquarium/shared';

const REDACTED = '[REDACTED]';
const BLOCKED_MESSAGE = '[此消息因包含敏感信息被安全策略拦截]';

// min credential length to index (avoid short-value false positives)
const MIN_CREDENTIAL_LENGTH = 8;

// Min chunk length for workspace content indexing (avoids false positives on short common phrases)
const MIN_WORKSPACE_CHUNK_LENGTH = 40;
// Number of chunk matches required to consider it a system prompt dump
const WORKSPACE_CHUNK_MATCH_THRESHOLD = 3;

// ── Credential Index (in-memory, per instance) ──

const credentialIndexes = new Map<string, Set<string>>();

export function buildCredentialIndex(instanceId: string, credentialValues: string[]): void {
  const index = new Set<string>();
  for (const value of credentialValues) {
    if (value.length >= MIN_CREDENTIAL_LENGTH) {
      index.add(value);
    }
  }
  if (index.size > 0) {
    credentialIndexes.set(instanceId, index);
  }
}

export function clearCredentialIndex(instanceId: string): void {
  credentialIndexes.delete(instanceId);
}

export function getCredentialIndex(instanceId: string): Set<string> | undefined {
  return credentialIndexes.get(instanceId);
}

// ── Workspace Content Index (per instance) ──
// Stores meaningful text chunks from workspace files (SOUL.md, AGENTS.md, etc.)
// so the output filter can detect when the AI dumps its system prompt verbatim.

const workspaceContentIndexes = new Map<string, string[]>();

function extractChunks(content: string, minLength: number): string[] {
  const chunks: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length >= minLength && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.startsWith('```')) {
      chunks.push(trimmed);
    }
  }
  return chunks;
}

export function buildWorkspaceContentIndex(instanceId: string, workspaceFiles: Record<string, string>): void {
  const allChunks: string[] = [];
  for (const content of Object.values(workspaceFiles)) {
    if (content) {
      allChunks.push(...extractChunks(content, MIN_WORKSPACE_CHUNK_LENGTH));
    }
  }
  if (allChunks.length > 0) {
    workspaceContentIndexes.set(instanceId, allChunks);
  }
}

export function clearWorkspaceContentIndex(instanceId: string): void {
  workspaceContentIndexes.delete(instanceId);
}

// ── API Key patterns (compiled once) ──

const API_KEY_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[A-Za-z0-9]{20,}/g, label: 'OpenAI' },
  { re: /sk-ant-[A-Za-z0-9-]{20,}/g, label: 'Anthropic' },
  { re: /ghp_[A-Za-z0-9]{36,}/g, label: 'GitHub PAT' },
  { re: /gho_[A-Za-z0-9]{36,}/g, label: 'GitHub OAuth' },
  { re: /github_pat_[A-Za-z0-9_]{22,}/g, label: 'GitHub Fine-grained PAT' },
  { re: /AKIA[0-9A-Z]{16}/g, label: 'AWS Access Key' },
  { re: /xoxb-[0-9]{10,}-[0-9]+-[A-Za-z0-9]+/g, label: 'Slack Bot Token' },
  { re: /xoxp-[0-9]{10,}-[0-9]+-[0-9]+-[a-f0-9]+/g, label: 'Slack User Token' },
  { re: /(?<=^|[^A-Za-z0-9])[A-Za-z0-9]{32,}(?=[^A-Za-z0-9]|$)/g, label: 'Generic Long Token' },
];

// ── System prompt leak detection ──
// Fragments from SOUL.md security paragraphs that should never appear in agent output
const SYSTEM_PROMPT_FRAGMENTS = [
  '<!-- SECURITY SECTION',
  '<!-- END SECURITY SECTION -->',
  '<!-- CIT-122: Trust Level Indicators',
  '<!-- END CIT-122 -->',
  '信任降级原则',
  '永远不做清单',
  '以下行为**绝对禁止**',
  '可疑指令识别',
];

// ── Environment / internal path patterns ──

const ENV_LEAK_PATTERNS: RegExp[] = [
  /process\.env\.[A-Z_]{3,}/g,
  /\/etc\/(?:passwd|shadow|hosts|resolv\.conf|ssl)/g,
  /\$\{?(?:HOME|PATH|SECRET|API_KEY|TOKEN|DATABASE_URL|ENCRYPTION_KEY|LITELLM_PROXY_URL)[}\s]/g,
];

const INTERNAL_PATH_PATTERNS: RegExp[] = [
  /\/home\/node\/\.openclaw\//g,
  /\/home\/openclaw\//g,
  /\/workspace\/(?:SOUL|AGENTS|IDENTITY|USER|TOOLS|BOOTSTRAP|HEARTBEAT|MEMORY)\.md/g,
  /\/opt\/openclaw-plugins\//g,
];

// ── Core filter function ──

export function filterOutput(
  content: string,
  instanceId: string,
  dlpConfig: DlpConfig,
): OutputFilterResult {
  const start = performance.now();
  const matches: OutputFilterMatch[] = [];
  let filtered = content;

  // 1. Credential reverse match (highest priority)
  if (dlpConfig.credentialLeakProtection) {
    const index = credentialIndexes.get(instanceId);
    if (index) {
      for (const credValue of index) {
        let searchFrom = 0;
        while (true) {
          const idx = filtered.indexOf(credValue, searchFrom);
          if (idx === -1) break;
          matches.push({
            category: 'credential_leak',
            redactedSnippet: credValue.slice(0, 4) + '***',
          });
          if (dlpConfig.mode === 'redact' || dlpConfig.mode === 'block') {
            filtered = filtered.slice(0, idx) + REDACTED + filtered.slice(idx + credValue.length);
            searchFrom = idx + REDACTED.length;
          } else {
            searchFrom = idx + credValue.length;
          }
        }
      }
    }
  }

  // 2. API Key pattern detection
  if (dlpConfig.apiKeyPatternDetection) {
    for (const { re } of API_KEY_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(filtered)) !== null) {
        const matchText = match[0];
        if (matchText === REDACTED) continue;
        if (filtered.slice(match.index, match.index + REDACTED.length) === REDACTED) continue;

        matches.push({
          category: 'api_key_pattern',
          redactedSnippet: matchText.slice(0, 6) + '***',
        });
        if (dlpConfig.mode === 'redact' || dlpConfig.mode === 'block') {
          filtered = filtered.slice(0, match.index) + REDACTED + filtered.slice(match.index + matchText.length);
          re.lastIndex = match.index + REDACTED.length;
        }
      }
    }
  }

  // 3. System prompt leak detection
  if (dlpConfig.systemPromptLeakProtection) {
    for (const fragment of SYSTEM_PROMPT_FRAGMENTS) {
      const idx = filtered.indexOf(fragment);
      if (idx !== -1) {
        matches.push({
          category: 'system_prompt_leak',
          redactedSnippet: fragment.slice(0, 30) + '…',
        });
        if (dlpConfig.mode === 'redact' || dlpConfig.mode === 'block') {
          filtered = filtered.slice(0, idx) + REDACTED + filtered.slice(idx + fragment.length);
        }
      }
    }

    // 3b. Workspace content verbatim dump detection (CIT-179)
    const wsChunks = workspaceContentIndexes.get(instanceId);
    if (wsChunks) {
      let chunkHits = 0;
      for (const chunk of wsChunks) {
        if (filtered.includes(chunk)) {
          chunkHits++;
        }
        if (chunkHits >= WORKSPACE_CHUNK_MATCH_THRESHOLD) {
          matches.push({
            category: 'system_prompt_leak',
            redactedSnippet: 'Workspace file content dump detected',
          });
          if (dlpConfig.mode === 'redact' || dlpConfig.mode === 'block') {
            filtered = BLOCKED_MESSAGE;
          }
          break;
        }
      }
    }
  }

  // 4. Environment variable leak
  if (dlpConfig.envLeakProtection) {
    for (const re of ENV_LEAK_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(filtered)) !== null) {
        if (filtered.slice(match.index, match.index + REDACTED.length) === REDACTED) continue;
        matches.push({
          category: 'env_leak',
          redactedSnippet: match[0].slice(0, 20) + '…',
        });
        if (dlpConfig.mode === 'redact' || dlpConfig.mode === 'block') {
          filtered = filtered.slice(0, match.index) + REDACTED + filtered.slice(match.index + match[0].length);
          re.lastIndex = match.index + REDACTED.length;
        }
      }
    }
  }

  // 5. Internal path leak
  if (dlpConfig.internalPathProtection) {
    for (const re of INTERNAL_PATH_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(filtered)) !== null) {
        if (filtered.slice(match.index, match.index + REDACTED.length) === REDACTED) continue;
        matches.push({
          category: 'internal_path_leak',
          redactedSnippet: match[0].slice(0, 20) + '…',
        });
        if (dlpConfig.mode === 'redact' || dlpConfig.mode === 'block') {
          filtered = filtered.slice(0, match.index) + REDACTED + filtered.slice(match.index + match[0].length);
          re.lastIndex = match.index + REDACTED.length;
        }
      }
    }
  }

  // Apply block mode: if any match found, replace entire content
  if (matches.length > 0 && dlpConfig.mode === 'block') {
    filtered = BLOCKED_MESSAGE;
  }

  return {
    filtered: matches.length > 0,
    mode: dlpConfig.mode,
    filteredContent: matches.length > 0 ? filtered : content,
    matches,
    durationMs: Math.round((performance.now() - start) * 100) / 100,
  };
}

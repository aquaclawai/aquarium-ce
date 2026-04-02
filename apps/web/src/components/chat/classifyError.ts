import type { ChatErrorCategory } from '@aquarium/shared';

const ERROR_PATTERNS: Array<{ pattern: RegExp; category: ChatErrorCategory }> = [
  { pattern: /timed?\s*out|timeout|no response|deadline exceeded/i, category: 'timeout' },
  { pattern: /auth|unauthorized|401|invalid.*key|api.?key|credential|forbidden|403/i, category: 'auth' },
  { pattern: /quota|rate.?limit|429|insufficient.*funds|billing|balance|limit exceeded/i, category: 'quota' },
  { pattern: /model.*not.*found|model.*unavailable|unsupported.*model|does not exist/i, category: 'model' },
  { pattern: /gateway|connect|ECONNREFUSED|ECONNRESET|socket|relay|not ready/i, category: 'gateway' },
];

export function classifyChatError(errorMessage: string): ChatErrorCategory {
  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) return category;
  }
  return 'unknown';
}

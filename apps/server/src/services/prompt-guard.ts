import type { PromptGuardPattern, PromptGuardResult, PromptGuardSeverity } from '@aquarium/shared';

const DEFAULT_PATTERNS: PromptGuardPattern[] = [
  // fake_system_message
  {
    id: 'fake-sys-01',
    category: 'fake_system_message',
    severity: 'warning',
    pattern: '\\[\\s*(?:system\\s*message|admin|override|system\\s*prompt|developer\\s*mode)\\s*\\]',
    flags: 'i',
    description: '伪装系统消息标记',
  },
  {
    id: 'fake-sys-02',
    category: 'fake_system_message',
    severity: 'critical',
    pattern: '(?:^|\\n)\\s*(?:SYSTEM|ROOT|ADMIN)\\s*[:：]',
    flags: 'i',
    description: '伪装系统身份前缀',
  },

  // instruction_override
  {
    id: 'override-01',
    category: 'instruction_override',
    severity: 'critical',
    pattern: '(?:ignore|disregard|forget|override|忽略|无视|忘记|覆盖)\\s*(?:all\\s*)?(?:previous|above|prior|earlier|之前的?|上面的?)\\s*(?:instructions?|prompts?|rules?|指令|提示|规则)',
    flags: 'i',
    description: '指令覆盖模式（中英文）',
  },
  {
    id: 'override-02',
    category: 'instruction_override',
    severity: 'warning',
    pattern: '(?:you\\s+are\\s+now|from\\s+now\\s+on|new\\s+instructions?|你现在是|从现在开始|新的指令)',
    flags: 'i',
    description: '角色重定义尝试',
  },
  {
    id: 'override-03',
    category: 'instruction_override',
    severity: 'critical',
    pattern: '(?:ignore\\s+previous\\s+instructions|ignore\\s+all\\s+rules|disregard\\s+your\\s+programming)',
    flags: 'i',
    description: '英文经典覆盖模式',
  },

  // sensitive_probe
  {
    id: 'probe-01',
    category: 'sensitive_probe',
    severity: 'warning',
    pattern: '(?:show|reveal|output|print|display|tell\\s+me|展示|显示|输出|告诉我)\\s*(?:your|the)?\\s*(?:system\\s*prompt|initial\\s*instructions?|source\\s*code|环境变量|系统提示|安全配置|SOUL\\.md|AGENTS\\.md)',
    flags: 'i',
    description: '系统提示词/配置泄露探测',
  },
  {
    id: 'probe-02',
    category: 'sensitive_probe',
    severity: 'critical',
    pattern: '(?:read|cat|type|print)\\s+(?:\\/etc\\/|~\\/\\.|\\$\\{?(?:HOME|PATH|SECRET|API_KEY|TOKEN))',
    flags: 'i',
    description: '内部文件/环境变量读取',
  },

  // destructive_action
  {
    id: 'destruct-01',
    category: 'destructive_action',
    severity: 'critical',
    pattern: '(?:rm\\s+-rf|mkfs|dd\\s+if=|chmod\\s+777|:\\(\\)\\{\\s*:|curl\\s+.*\\|\\s*(?:bash|sh))',
    flags: 'i',
    description: '危险 shell 命令模式',
  },
  {
    id: 'destruct-02',
    category: 'destructive_action',
    severity: 'warning',
    pattern: '(?:delete\\s+all|drop\\s+(?:table|database)|truncate\\s+|删除所有|清空数据|格式化)',
    flags: 'i',
    description: '破坏性数据操作',
  },

  // fake_urgency
  {
    id: 'urgency-01',
    category: 'fake_urgency',
    severity: 'warning',
    pattern: '(?:URGENT|EMERGENCY|CRITICAL)\\s*(?:SYSTEM\\s*)?(?:UPDATE|OVERRIDE|PATCH|MESSAGE|NOTICE|ALERT)',
    flags: 'i',
    description: '伪装紧急系统通知',
  },
  {
    id: 'urgency-02',
    category: 'fake_urgency',
    severity: 'warning',
    pattern: '(?:紧急更新|紧急通知|立即执行|必须马上)',
    flags: 'i',
    description: '伪装紧急中文通知',
  },

  // repetition_attack — 20+ chars repeated 5+ times (context window exhaustion)
  {
    id: 'repeat-01',
    category: 'repetition_attack',
    severity: 'info',
    pattern: '(.{20,})\\1{4,}',
    description: '重复内容攻击（上下文窗口耗尽）',
  },
];

const SEVERITY_ORDER: Record<PromptGuardSeverity, number> = { info: 0, warning: 1, critical: 2 };

const compiledCache = new Map<string, RegExp>();

function getCompiledPattern(p: PromptGuardPattern): RegExp {
  const cacheKey = `${p.id}:${p.pattern}:${p.flags ?? 'i'}`;
  let re = compiledCache.get(cacheKey);
  if (!re) {
    re = new RegExp(p.pattern, p.flags ?? 'i');
    compiledCache.set(cacheKey, re);
  }
  return re;
}

function sanitizeSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, (match.index ?? 0) - 20);
  const end = Math.min(text.length, (match.index ?? 0) + (match[0]?.length ?? 0) + 20);
  let snippet = text.slice(start, end);
  if (snippet.length > 100) snippet = snippet.slice(0, 100) + '…';
  return snippet;
}

export function scanMessage(
  text: string,
  customPatterns?: PromptGuardPattern[],
): PromptGuardResult {
  const start = performance.now();
  const allPatterns = customPatterns
    ? [...DEFAULT_PATTERNS, ...customPatterns]
    : DEFAULT_PATTERNS;

  const matches: PromptGuardResult['matches'] = [];
  let maxSeverityValue = -1;
  let maxSeverity: PromptGuardSeverity | null = null;

  for (const pattern of allPatterns) {
    try {
      const re = getCompiledPattern(pattern);
      re.lastIndex = 0;
      const match = re.exec(text);
      if (match) {
        matches.push({
          patternId: pattern.id,
          category: pattern.category,
          severity: pattern.severity,
          matchedSnippet: sanitizeSnippet(text, match),
        });
        const sv = SEVERITY_ORDER[pattern.severity];
        if (sv > maxSeverityValue) {
          maxSeverityValue = sv;
          maxSeverity = pattern.severity;
        }
      }
    } catch {
      // Skip malformed custom patterns silently
    }
  }

  return {
    detected: matches.length > 0,
    maxSeverity,
    matches,
    durationMs: Math.round((performance.now() - start) * 100) / 100,
  };
}

export function getDefaultPatterns(): PromptGuardPattern[] {
  return [...DEFAULT_PATTERNS];
}

export { SEVERITY_ORDER };

export interface DlpFinding {
  patternName: string;
  filename: string;
  lineNumber: number;
  redacted: string;
}

interface SensitivePattern {
  name: string;
  pattern: RegExp;
  minLength?: number;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    name: 'OpenAI API Key',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    minLength: 24,
  },
  {
    name: 'Anthropic API Key',
    pattern: /sk-ant-[a-zA-Z0-9-]{80,}/g,
    minLength: 86,
  },
  {
    name: 'GitHub PAT',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
  },
  {
    name: 'GitHub OAuth Token',
    pattern: /gho_[a-zA-Z0-9]{36}/g,
  },
  {
    name: 'GitHub Fine-grained PAT',
    pattern: /github_pat_[a-zA-Z0-9_]{82}/g,
  },
  {
    name: 'PEM Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/g,
  },
  {
    name: 'Google API Key',
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    name: 'Stripe Secret Key',
    pattern: /sk_live_[a-zA-Z0-9]{24,}/g,
    minLength: 32,
  },
  {
    name: 'Ethereum Private Key',
    pattern: /(?:0x)?[0-9a-fA-F]{64}(?=\s|$|['"`,;)\]}])/g,
  },
];

function redactMatch(match: string): string {
  if (match.length <= 8) return '***';
  const prefix = match.slice(0, 4);
  const suffix = match.slice(-4);
  return `${prefix}${'*'.repeat(Math.min(match.length - 8, 20))}${suffix}`;
}

export function scanContent(content: string, filename: string): DlpFinding[] {
  const findings: DlpFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const sp of SENSITIVE_PATTERNS) {
      // Reset lastIndex for global regexes
      sp.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = sp.pattern.exec(line)) !== null) {
        const matchStr = match[0];

        // Skip if too short (false positive filter)
        if (sp.minLength && matchStr.length < sp.minLength) continue;

        findings.push({
          patternName: sp.name,
          filename,
          lineNumber: i + 1,
          redacted: redactMatch(matchStr),
        });
      }
    }
  }

  return findings;
}

export function scanWorkspaceFiles(files: Map<string, string>): DlpFinding[] {
  const allFindings: DlpFinding[] = [];

  for (const [filename, content] of files) {
    const findings = scanContent(content, filename);
    allFindings.push(...findings);
  }

  return allFindings;
}

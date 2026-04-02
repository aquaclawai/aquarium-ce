import { config } from '../config.js';

const REDACT_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[JWT:***]' },
  { re: /sk-[A-Za-z0-9]{20,}/g, replacement: '[KEY:***]' },
  { re: /sk-ant-[A-Za-z0-9-]{20,}/g, replacement: '[KEY:***]' },
  { re: /ghp_[A-Za-z0-9]{36,}/g, replacement: '[KEY:***]' },
  { re: /gho_[A-Za-z0-9]{36,}/g, replacement: '[KEY:***]' },
  { re: /AKIA[0-9A-Z]{16}/g, replacement: '[KEY:***]' },
  { re: /xoxb-[0-9]{10,}-[0-9]+-[A-Za-z0-9]+/g, replacement: '[KEY:***]' },
  { re: /"password"\s*:\s*"[^"]*"/gi, replacement: '"password":"[REDACTED]"' },
  { re: /"password_hash"\s*:\s*"[^"]*"/gi, replacement: '"password_hash":"[REDACTED]"' },
  { re: /postgres(?:ql)?:\/\/[^\s"]+/gi, replacement: '[DB_URL:***]' },
  { re: /"encrypted_value"\s*:\s*"[^"]*"/gi, replacement: '"encrypted_value":"[REDACTED]"' },
];

function redactString(input: string): string {
  let result = input;
  for (const { re, replacement } of REDACT_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, replacement);
  }
  return result;
}

function redactArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (typeof arg === 'string') return redactString(arg);
    if (arg instanceof Error) {
      arg.message = redactString(arg.message);
      return arg;
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.parse(redactString(JSON.stringify(arg)));
      } catch {
        return arg;
      }
    }
    return arg;
  });
}

let installed = false;

export function installLogRedaction(): void {
  if (installed) return;
  if (!config.logRedactionEnabled) return;

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => origLog(...redactArgs(args));
  console.warn = (...args: unknown[]) => origWarn(...redactArgs(args));
  console.error = (...args: unknown[]) => origError(...redactArgs(args));

  installed = true;
}

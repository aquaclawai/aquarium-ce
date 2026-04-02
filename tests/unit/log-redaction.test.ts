import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

describe('log redaction patterns', () => {
  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789jkl';
    const r = redactString(`Token: ${jwt}`);
    assert.ok(!r.includes('eyJ'));
    assert.ok(r.includes('[JWT:***]'));
  });

  it('redacts OpenAI API keys', () => {
    const r = redactString('Key: sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678');
    assert.ok(!r.includes('sk-aBcD'));
    assert.ok(r.includes('[KEY:***]'));
  });

  it('redacts Anthropic API keys', () => {
    const r = redactString('Key: sk-ant-abc123def456ghi789jkl012');
    assert.ok(!r.includes('sk-ant-'));
    assert.ok(r.includes('[KEY:***]'));
  });

  it('redacts GitHub PAT', () => {
    const r = redactString('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl');
    assert.ok(!r.includes('ghp_'));
    assert.ok(r.includes('[KEY:***]'));
  });

  it('redacts GitHub OAuth token', () => {
    const r = redactString('gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl');
    assert.ok(!r.includes('gho_'));
    assert.ok(r.includes('[KEY:***]'));
  });

  it('redacts AWS access key', () => {
    const r = redactString('AKIAIOSFODNN7EXAMPLE');
    assert.ok(!r.includes('AKIAIOSF'));
    assert.ok(r.includes('[KEY:***]'));
  });

  it('redacts Slack bot token', () => {
    const r = redactString('xoxb-1234567890-9876543210-AbCdEfGhIjKl');
    assert.ok(!r.includes('xoxb-'));
    assert.ok(r.includes('[KEY:***]'));
  });

  it('redacts password JSON field', () => {
    const r = redactString('{"email":"a@b.com","password":"super-secret-123"}');
    assert.ok(!r.includes('super-secret-123'));
    assert.ok(r.includes('"password":"[REDACTED]"'));
  });

  it('redacts password_hash JSON field', () => {
    const r = redactString('{"password_hash":"$2b$10$hashedvalue"}');
    assert.ok(!r.includes('$2b$10$'));
    assert.ok(r.includes('"password_hash":"[REDACTED]"'));
  });

  it('redacts PostgreSQL connection string', () => {
    const r = redactString('Connecting to postgres://user:pass@host:5432/db');
    assert.ok(!r.includes('postgres://'));
    assert.ok(r.includes('[DB_URL:***]'));
  });

  it('redacts postgresql:// variant', () => {
    const r = redactString('postgresql://admin:secret@localhost/mydb');
    assert.ok(!r.includes('postgresql://'));
    assert.ok(r.includes('[DB_URL:***]'));
  });

  it('redacts encrypted_value JSON field', () => {
    const r = redactString('{"encrypted_value":"abcdef123456:tag:ciphertext"}');
    assert.ok(!r.includes('abcdef123456'));
    assert.ok(r.includes('"encrypted_value":"[REDACTED]"'));
  });

  it('preserves normal log messages unchanged', () => {
    const msg = '[gateway-relay] Connected to instance abc-123';
    assert.equal(redactString(msg), msg);
  });

  it('handles multiple sensitive values in one string', () => {
    const input = 'JWT eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789jkl key sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ12345678';
    const r = redactString(input);
    assert.ok(r.includes('[JWT:***]'));
    assert.ok(r.includes('[KEY:***]'));
    assert.ok(!r.includes('eyJ'));
    assert.ok(!r.includes('sk-aBcD'));
  });
});

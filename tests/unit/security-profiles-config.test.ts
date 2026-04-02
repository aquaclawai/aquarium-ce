import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPromptGuardConfig, getDlpConfig } from '../../apps/server/src/agent-types/openclaw/security-profiles.js';
import type { SecurityProfile } from '@aquarium/shared';

const PROFILES: SecurityProfile[] = ['strict', 'standard', 'developer', 'unrestricted'];

describe('getPromptGuardConfig', () => {
  it('strict: enabled, minAlertSeverity=info, logEvents=true, pushEvents=true', () => {
    const c = getPromptGuardConfig('strict');
    assert.equal(c.enabled, true);
    assert.equal(c.minAlertSeverity, 'info');
    assert.equal(c.logEvents, true);
    assert.equal(c.pushEvents, true);
    assert.deepEqual(c.customPatterns, []);
  });

  it('standard: enabled, minAlertSeverity=warning', () => {
    const c = getPromptGuardConfig('standard');
    assert.equal(c.enabled, true);
    assert.equal(c.minAlertSeverity, 'warning');
    assert.equal(c.logEvents, true);
    assert.equal(c.pushEvents, true);
  });

  it('developer: enabled, minAlertSeverity=critical, pushEvents=false', () => {
    const c = getPromptGuardConfig('developer');
    assert.equal(c.enabled, true);
    assert.equal(c.minAlertSeverity, 'critical');
    assert.equal(c.logEvents, true);
    assert.equal(c.pushEvents, false);
  });

  it('unrestricted: disabled', () => {
    const c = getPromptGuardConfig('unrestricted');
    assert.equal(c.enabled, false);
    assert.equal(c.logEvents, false);
    assert.equal(c.pushEvents, false);
  });

  it('includes template custom patterns', () => {
    const c = getPromptGuardConfig('standard', {
      customSuspiciousPatterns: ['evil\\s+pattern'],
    });
    assert.equal(c.customPatterns.length, 1);
    assert.equal(c.customPatterns[0].id, 'custom-0');
    assert.equal(c.customPatterns[0].pattern, 'evil\\s+pattern');
    assert.equal(c.customPatterns[0].severity, 'warning');
  });

  it('returns empty customPatterns when no template config', () => {
    for (const p of PROFILES) {
      const c = getPromptGuardConfig(p);
      assert.deepEqual(c.customPatterns, []);
    }
  });
});

describe('getDlpConfig', () => {
  it('strict: all protections enabled, mode=block', () => {
    const c = getDlpConfig('strict');
    assert.notEqual(c, null);
    assert.equal(c!.credentialLeakProtection, true);
    assert.equal(c!.apiKeyPatternDetection, true);
    assert.equal(c!.systemPromptLeakProtection, true);
    assert.equal(c!.envLeakProtection, true);
    assert.equal(c!.internalPathProtection, true);
    assert.equal(c!.mode, 'block');
  });

  it('standard: all protections enabled, mode=redact', () => {
    const c = getDlpConfig('standard');
    assert.notEqual(c, null);
    assert.equal(c!.credentialLeakProtection, true);
    assert.equal(c!.apiKeyPatternDetection, true);
    assert.equal(c!.systemPromptLeakProtection, true);
    assert.equal(c!.mode, 'redact');
  });

  it('developer: credential+apikey only, mode=warn', () => {
    const c = getDlpConfig('developer');
    assert.notEqual(c, null);
    assert.equal(c!.credentialLeakProtection, true);
    assert.equal(c!.apiKeyPatternDetection, true);
    assert.equal(c!.systemPromptLeakProtection, false);
    assert.equal(c!.envLeakProtection, false);
    assert.equal(c!.internalPathProtection, false);
    assert.equal(c!.mode, 'warn');
  });

  it('unrestricted: null (disabled)', () => {
    const c = getDlpConfig('unrestricted');
    assert.equal(c, null);
  });

  it('all profiles return valid config or null', () => {
    for (const p of PROFILES) {
      const c = getDlpConfig(p);
      if (c !== null) {
        assert.ok(typeof c.credentialLeakProtection === 'boolean');
        assert.ok(['redact', 'block', 'warn'].includes(c.mode));
      }
    }
  });
});

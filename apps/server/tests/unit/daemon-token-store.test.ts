import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  setupTestDb,
  teardownTestDb,
  seedDaemonToken,
} from './test-db.js';
import {
  generateDaemonTokenPlaintext,
  hashDaemonToken,
  issueDaemonToken,
  listDaemonTokens,
  revokeDaemonToken,
} from '../../src/services/daemon-token-store.js';

/**
 * Phase 19-01 daemon-token-store unit tests.
 *
 * Covers DAEMON-09 (token format, SHA-256, plaintext-once):
 *   • Token shape — `adt_<32 base64url>` = 36 chars
 *   • Entropy — 10,000 generations produce 10,000 unique plaintexts
 *   • Hash stability — `hashDaemonToken(x)` === `sha256(x).hex`
 *   • Hash roundtrip — fresh plaintext → fresh 64-char hex
 *   • issue: insert returns `{ token: DaemonToken, plaintext }`; DB row matches
 *   • list: workspace-scoped projection, no plaintext / no token_hash
 *   • list filter: other-workspace rows excluded
 *   • revoke happy: first call true → `revoked_at IS NOT NULL`
 *   • revoke idempotent: second call false
 *   • revoke wrong workspace: false, original row untouched
 *   • seedDaemonToken helper: returns { id, plaintext, tokenHash } with DB row present
 */

async function seedUser(db: Awaited<ReturnType<typeof setupTestDb>>['db']): Promise<string> {
  const id = randomUUID();
  await db('users').insert({
    id,
    email: `user-${id.slice(0, 8)}@test.local`,
    password_hash: null,
    display_name: 'Test User',
    role: 'user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

test('generateDaemonTokenPlaintext: format is adt_<32 base64url>', () => {
  const plaintext = generateDaemonTokenPlaintext();
  assert.match(plaintext, /^adt_[A-Za-z0-9_-]{32}$/, 'matches adt_ prefix + 32 base64url chars');
  assert.equal(plaintext.length, 36, 'total length is exactly 36');
});

test('generateDaemonTokenPlaintext: 10,000 generations are all unique (entropy check)', () => {
  const seen = new Set<string>();
  const N = 10_000;
  for (let i = 0; i < N; i += 1) {
    seen.add(generateDaemonTokenPlaintext());
  }
  assert.equal(seen.size, N, `expected ${N} unique tokens, got ${seen.size}`);
});

test('hashDaemonToken: stable and matches crypto.createHash("sha256")', () => {
  const fixture = 'adt_test';
  const expected = createHash('sha256').update(fixture).digest('hex');
  const actual = hashDaemonToken(fixture);
  assert.equal(actual, expected, 'hashDaemonToken matches manual sha256');
  assert.equal(actual.length, 64, 'sha256 hex is 64 chars');
  assert.match(actual, /^[0-9a-f]{64}$/, 'hex output');
  // Second call is stable.
  assert.equal(hashDaemonToken(fixture), expected, 'deterministic');
});

test('hashDaemonToken: roundtrip across generated plaintexts produces fresh 64-char hex', () => {
  const a = generateDaemonTokenPlaintext();
  const b = generateDaemonTokenPlaintext();
  const hashA = hashDaemonToken(a);
  const hashB = hashDaemonToken(b);
  assert.notEqual(hashA, hashB, 'different plaintexts produce different hashes');
  assert.equal(hashA.length, 64);
  assert.equal(hashB.length, 64);
});

test('issueDaemonToken: inserts row with matching hash and returns plaintext once', async () => {
  const ctx = await setupTestDb();
  try {
    const userId = await seedUser(ctx.db);
    const result = await issueDaemonToken(
      { workspaceId: 'AQ', name: 'laptop', createdByUserId: userId },
      ctx.db,
    );
    assert.match(result.plaintext, /^adt_[A-Za-z0-9_-]{32}$/);
    assert.equal(result.token.workspaceId, 'AQ');
    assert.equal(result.token.name, 'laptop');
    assert.equal(result.token.createdByUserId, userId);
    assert.equal(result.token.revokedAt, null);
    assert.equal(result.token.daemonId, null);

    const row = await ctx.db('daemon_tokens').where({ id: result.token.id }).first();
    assert.ok(row, 'row exists');
    assert.equal(row.token_hash, hashDaemonToken(result.plaintext), 'hash matches stored');
    assert.equal(row.revoked_at, null);
    assert.equal(row.created_by_user_id, userId);
  } finally {
    await teardownTestDb(ctx);
  }
});

test('listDaemonTokens: returns issued rows mapped to DaemonToken (no plaintext / hash)', async () => {
  const ctx = await setupTestDb();
  try {
    const userId = await seedUser(ctx.db);
    const issued = await issueDaemonToken(
      { workspaceId: 'AQ', name: 'one', createdByUserId: userId },
      ctx.db,
    );

    const listed = await listDaemonTokens('AQ', ctx.db);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, issued.token.id);
    assert.equal(listed[0].name, 'one');
    // Must NOT leak any hash / plaintext.
    const asRecord = listed[0] as unknown as Record<string, unknown>;
    assert.equal(asRecord.tokenHash, undefined, 'tokenHash is not projected');
    assert.equal(asRecord.plaintext, undefined, 'plaintext is not projected');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('listDaemonTokens: filters by workspaceId — other workspaces excluded', async () => {
  const ctx = await setupTestDb();
  try {
    const userId = await seedUser(ctx.db);
    // Create an additional workspace so the FK succeeds (migration 003 seeded 'AQ').
    await ctx.db('workspaces').insert({
      id: 'OTHER',
      name: 'Other',
      issue_prefix: 'OT',
      issue_counter: 0,
      owner_user_id: null,
      metadata: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await issueDaemonToken(
      { workspaceId: 'AQ', name: 'aq', createdByUserId: userId },
      ctx.db,
    );
    await issueDaemonToken(
      { workspaceId: 'OTHER', name: 'other', createdByUserId: userId },
      ctx.db,
    );
    const aqList = await listDaemonTokens('AQ', ctx.db);
    assert.equal(aqList.length, 1);
    assert.equal(aqList[0].name, 'aq');

    const otherList = await listDaemonTokens('OTHER', ctx.db);
    assert.equal(otherList.length, 1);
    assert.equal(otherList[0].name, 'other');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('revokeDaemonToken: first call flips revoked_at and returns true', async () => {
  const ctx = await setupTestDb();
  try {
    const userId = await seedUser(ctx.db);
    const issued = await issueDaemonToken(
      { workspaceId: 'AQ', name: 'rev', createdByUserId: userId },
      ctx.db,
    );
    const revoked = await revokeDaemonToken(issued.token.id, 'AQ', ctx.db);
    assert.equal(revoked, true, 'first revoke returns true');
    const row = await ctx.db('daemon_tokens').where({ id: issued.token.id }).first();
    assert.ok(row.revoked_at, 'revoked_at is set');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('revokeDaemonToken: idempotent — second call returns false', async () => {
  const ctx = await setupTestDb();
  try {
    const userId = await seedUser(ctx.db);
    const issued = await issueDaemonToken(
      { workspaceId: 'AQ', name: 'rev2', createdByUserId: userId },
      ctx.db,
    );
    const first = await revokeDaemonToken(issued.token.id, 'AQ', ctx.db);
    assert.equal(first, true);
    const second = await revokeDaemonToken(issued.token.id, 'AQ', ctx.db);
    assert.equal(second, false, 'already-revoked returns false');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('revokeDaemonToken: wrong workspace is rejected; original row untouched', async () => {
  const ctx = await setupTestDb();
  try {
    const userId = await seedUser(ctx.db);
    await ctx.db('workspaces').insert({
      id: 'OTHER',
      name: 'Other',
      issue_prefix: 'OT',
      issue_counter: 0,
      owner_user_id: null,
      metadata: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const issued = await issueDaemonToken(
      { workspaceId: 'AQ', name: 'protected', createdByUserId: userId },
      ctx.db,
    );
    const wrong = await revokeDaemonToken(issued.token.id, 'OTHER', ctx.db);
    assert.equal(wrong, false, 'cross-workspace revoke returns false');
    const row = await ctx.db('daemon_tokens').where({ id: issued.token.id }).first();
    assert.equal(row.revoked_at, null, 'row remains un-revoked');
  } finally {
    await teardownTestDb(ctx);
  }
});

test('seedDaemonToken: helper inserts a row and returns plaintext + id + hash', async () => {
  const ctx = await setupTestDb();
  try {
    const seeded = await seedDaemonToken(ctx.db, { workspaceId: 'AQ', name: 'seed' });
    assert.match(seeded.plaintext, /^adt_[A-Za-z0-9_-]{32}$/);
    assert.equal(seeded.tokenHash.length, 64);
    const row = await ctx.db('daemon_tokens').where({ id: seeded.id }).first();
    assert.ok(row, 'row inserted');
    assert.equal(row.name, 'seed');
    assert.equal(row.token_hash, seeded.tokenHash);
    assert.equal(row.workspace_id, 'AQ');
    assert.equal(row.revoked_at, null);
  } finally {
    await teardownTestDb(ctx);
  }
});

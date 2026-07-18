import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNdjson } from '../../src/daemon/ndjson-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures', 'claude-stream-sample.ndjson');

function streamFromLines(lines: string[]): Readable {
  return Readable.from(lines.map((l) => l + (l.endsWith('\n') ? '' : '\n')));
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const msg of gen) out.push(msg);
  return out;
}

describe('parseNdjson (BACKEND-06 / PG7, PG8, PG9, PG10)', () => {
  test('yields 3 objects from 3 well-formed lines', async () => {
    const stream = streamFromLines([
      '{"a":1}',
      '{"b":"hello"}',
      '{"c":[1,2,3]}',
    ]);
    const msgs = await collect(parseNdjson(stream));
    assert.deepEqual(msgs, [{ a: 1 }, { b: 'hello' }, { c: [1, 2, 3] }]);
  });

  test('PG10 — malformed middle line dropped, onParseError fired once', async () => {
    const errs: Array<{ line: string; msg: string }> = [];
    const stream = streamFromLines([
      '{"ok":1}',
      '{"type":"assist', // truncated
      '{"ok":2}',
    ]);
    const msgs = await collect(parseNdjson(stream, {
      onParseError: (line, err) => errs.push({ line, msg: err.message }),
    }));
    assert.deepEqual(msgs, [{ ok: 1 }, { ok: 2 }]);
    assert.equal(errs.length, 1);
    assert.match(errs[0]!.line, /"assist/);
  });

  test('PG9 — emoji + multi-byte UTF-8 round-trips', async () => {
    const stream = streamFromLines(['{"tool":"🔍Search","text":"héllo ñ"}']);
    const msgs = await collect(parseNdjson<{ tool: string; text: string }>(stream));
    assert.equal(msgs[0]!.tool, '🔍Search');
    assert.equal(msgs[0]!.text, 'héllo ñ');
  });

  test('PG7 — CRLF line endings parse correctly', async () => {
    const stream = Readable.from(['{"a":1}\r\n{"b":2}\r\n']);
    const msgs = await collect(parseNdjson(stream));
    assert.deepEqual(msgs, [{ a: 1 }, { b: 2 }]);
  });

  test('empty and whitespace-only lines are skipped silently', async () => {
    const errs: unknown[] = [];
    const stream = Readable.from(['\n\n{"a":1}\n   \n{"b":2}\n\n']);
    const msgs = await collect(parseNdjson(stream, {
      onParseError: (_l, e) => errs.push(e),
    }));
    assert.deepEqual(msgs, [{ a: 1 }, { b: 2 }]);
    assert.equal(errs.length, 0);
  });

  test('isValid guard filters non-matching values', async () => {
    type Msg = { type: 'ok'; v: number };
    const isMsg = (m: unknown): m is Msg =>
      typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'ok';
    const stream = streamFromLines([
      '{"type":"ok","v":1}',
      '{"type":"other","v":2}',
      '{"type":"ok","v":3}',
    ]);
    const msgs = await collect(parseNdjson<Msg>(stream, { isValid: isMsg }));
    assert.deepEqual(msgs.map((m) => m.v), [1, 3]);
  });

  test('consumes the shipped fixture and yields ≥ 6 parseable messages', async () => {
    const body = readFileSync(fixturePath, 'utf8');
    const stream = Readable.from([body]);
    const msgs = await collect(parseNdjson<{ type: string }>(stream));
    assert.ok(msgs.length >= 6, `expected >= 6 got ${msgs.length}`);
    const types = msgs.map((m) => m.type);
    assert.ok(types.includes('assistant'));
    assert.ok(types.includes('user'));
    assert.ok(types.includes('result'));
  });

  test('inactivity watchdog fires exactly once on silent stream', async () => {
    // Use a PassThrough-style stream that never emits; hand-rolled to avoid
    // a real timer-tick race. mock.timers makes the watchdog fire synchronously.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const stream = new Readable({ read() { /* never pushes */ } });
      let fired = 0;
      const gen = parseNdjson(stream, {
        inactivityMs: 1_000,
        onInactive: () => { fired++; stream.push(null); }, // end stream so generator resolves
      });
      const pending = collect(gen);
      // Tick just under — watchdog must NOT fire.
      mock.timers.tick(999);
      assert.equal(fired, 0);
      // Cross the threshold — watchdog fires, stream ends, generator resolves.
      mock.timers.tick(1);
      await pending;
      assert.equal(fired, 1);
    } finally {
      mock.timers.reset();
    }
  });

  test('stress: 100 mixed malformed + valid lines — never throws', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(i % 3 === 0 ? `not-json-${i}` : JSON.stringify({ i }));
    }
    const errCount = { n: 0 };
    const stream = streamFromLines(lines);
    const msgs = await collect(parseNdjson<{ i: number }>(stream, {
      onParseError: () => { errCount.n++; },
    }));
    // Exactly the non-%3 indices survive.
    const expected = lines.length - Math.ceil(lines.length / 3);
    assert.equal(msgs.length, expected);
    assert.equal(errCount.n, Math.ceil(lines.length / 3));
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../../src/daemon/semaphore.js';

describe('Semaphore (PG1 / CLI-04)', () => {
  test('acquire resolves immediately when capacity available', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    assert.equal(typeof r1, 'function');
    assert.deepEqual(sem.stats(), { available: 1, waiters: 0, max: 2 });
  });

  test('acquire with max=1 blocks second caller until release', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    let secondResolved = false;
    const p2 = sem.acquire().then((r) => { secondResolved = true; return r; });
    // micro-yield — second acquire should be queued, not resolved
    await Promise.resolve();
    assert.equal(secondResolved, false);
    assert.equal(sem.stats().waiters, 1);
    r1();
    const r2 = await p2;
    assert.equal(secondResolved, true);
    r2();
    assert.deepEqual(sem.stats(), { available: 1, waiters: 0, max: 1 });
  });

  test('FIFO order across three queued waiters', async () => {
    const sem = new Semaphore(1);
    const holder = await sem.acquire();
    const order: string[] = [];
    const pA = sem.acquire().then((r) => { order.push('A'); return r; });
    const pB = sem.acquire().then((r) => { order.push('B'); return r; });
    const pC = sem.acquire().then((r) => { order.push('C'); return r; });
    holder();
    const rA = await pA; rA();
    const rB = await pB; rB();
    const rC = await pC; rC();
    assert.deepEqual(order, ['A', 'B', 'C']);
  });

  test('release with waiters transfers slot without bumping available', async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    const p2 = sem.acquire();
    r1();
    // When r1 released and p2 was queued, available should remain 0 (slot transferred).
    assert.equal(sem.stats().available, 0);
    const r2 = await p2;
    r2();
    assert.equal(sem.stats().available, 1);
  });

  test('double-release is a no-op (idempotent)', async () => {
    const sem = new Semaphore(1);
    const r = await sem.acquire();
    r();
    r(); // second call must NOT bump available past max
    assert.equal(sem.stats().available, 1);
  });

  test('constructor rejects invalid max values', () => {
    assert.throws(() => new Semaphore(0), RangeError);
    assert.throws(() => new Semaphore(-1), RangeError);
    assert.throws(() => new Semaphore(1.5), RangeError);
    assert.throws(() => new Semaphore(NaN), RangeError);
  });

  test('stress: 100 parallel acquires with max=3 all settle', async () => {
    const sem = new Semaphore(3);
    const results: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 100 }, (_, i) => (async () => {
      const release = await sem.acquire();
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // let the event loop observe inFlight before we release
      await new Promise((r) => setImmediate(r));
      results.push(i);
      inFlight--;
      release();
    })());
    await Promise.all(tasks);
    assert.equal(results.length, 100);
    assert.ok(maxInFlight <= 3, `maxInFlight=${maxInFlight} must be <= 3`);
    assert.deepEqual(sem.stats(), { available: 3, waiters: 0, max: 3 });
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

const { generateSafePrimesParallel, generateAuxPrimeSeedHex } = await import(
  '../js/mpc-cggmp24-aux-worker.js'
);

// A fake worker that, on postMessage, either fails or returns exactly one prime
// after `delay` ms. `prime`/`delay`/`fail` are fixed per worker instance.
function createFakeWorker({ prime, delay = 0, fail = false } = {}) {
  const handlers = { message: null, error: null };
  let terminated = false;
  const postMessage = () => {
    setTimeout(() => {
      if (terminated) return;
      if (fail) {
        if (handlers.error) handlers.error(new Error(`${prime}-boom`));
        return;
      }
      if (handlers.message) handlers.message({ data: { success: true, prime } });
    }, delay);
  };
  return {
    set onmessage(handler) { handlers.message = handler; },
    set onerror(handler) { handlers.error = handler; },
    postMessage,
    terminate() { terminated = true; },
    isTerminated() { return terminated; }
  };
}

// Builds a Worker constructor whose Nth instance returns `results[N]` after
// `delays[N]` ms, or fails if N < `failures`.
function createFakeWorkerPool({ results, delays = [], failures = 0 } = {}) {
  const workers = [];
  function WorkerCtor() {
    const idx = workers.length;
    const w = createFakeWorker({
      prime: results[idx],
      delay: delays[idx] || 0,
      fail: idx < failures
    });
    workers.push(w);
    return w;
  }
  WorkerCtor.workers = workers;
  return WorkerCtor;
}

test('generateSafePrimesParallel resolves with the first TAKE primes and terminates the whole pool', async () => {
  const poolSize = 6;
  const take = 4;
  // Each fake worker gets a fresh copy of `results` so that its per-worker
  // message counter advances independently of the other workers.
  const results = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const delays = [120, 5, 10, 15, 20, 25]; // p0 is slow; the fastest 4 are p1..p4

  const WorkerCtor = createFakeWorkerPool({ results, delays });
  const seeds = ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e', 'seed-f'];
  let i = 0;
  const seedFactory = () => seeds[i++];

  const primes = await generateSafePrimesParallel({
    poolSize,
    take,
    workerCtor: WorkerCtor,
    seedFactory
  });

  // Pool is over-provisioned: 6 spawned, fastest 4 resolve.
  assert.equal(WorkerCtor.workers.length, poolSize);
  assert.equal(primes.length, take);
  // The 4 winners come from the 5 fastest of the pool (we sent p0 first, slow).
  assert.deepEqual(primes, ['p1', 'p2', 'p3', 'p4']);

  // Wait a tick so any pending setTimeouts fire; verify every worker was terminated.
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const w of WorkerCtor.workers) {
    assert.equal(w.isTerminated(), true, 'every worker should be terminated');
  }
});

test('generateSafePrimesParallel rejects when too many workers fail before TAKE primes arrive', async () => {
  // poolSize 6, take 4 → tolerate 2 failures; 3rd failure is fatal.
  const WorkerCtor = createFakeWorkerPool({
    results: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
    failures: 3
  });

  await assert.rejects(
    () => generateSafePrimesParallel({
      poolSize: 6,
      take: 4,
      workerCtor: WorkerCtor,
      seedFactory: (i => () => `seed-${i++}`)(0)
    }),
    /MPC_AUX_PRIME_TOO_MANY_FAILURES/
  );
});

test('generateSafePrimesParallel rejects when no worker constructor is available', async () => {
  await assert.rejects(
    () => generateSafePrimesParallel({
      poolSize: 6,
      take: 4,
      workerCtor: null
    }),
    /MPC_AUX_PRIME_GEN_FAILED/
  );
});

test('generateAuxPrimeSeedHex returns a 64-character hex string', () => {
  const seed = generateAuxPrimeSeedHex();
  assert.match(seed, /^[0-9a-f]{64}$/);
  // Two calls should differ (random).
  const seed2 = generateAuxPrimeSeedHex();
  assert.notEqual(seed, seed2);
});
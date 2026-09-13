import initCggmp24Wasm, * as cggmp24Wasm from './background/wasm/cggmp24/mpc_cggmp24_spike.js';
import { Cggmp24WasmEngine, logMpcCggmpDebug } from './background/mpc-cggmp24-wasm-engine.js';

let enginePromise = null;

function summarizeState(state) {
  const parties = Array.isArray(state?.parties) ? [...state.parties] : [];
  return {
    protocol: 'aux-info',
    sessionId: String(state?.sessionId || ''),
    senderIndex: Number(state?.senderIndex),
    parties,
    partyCount: Number(state?.partyCount || parties.length || 0),
    curve: state?.curve || 'secp256k1',
    requestId: String(state?.requestId || ''),
    remoteAuxInfo: true
  };
}

async function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      await initCggmp24Wasm();
      return new Cggmp24WasmEngine({
        wasm: cggmp24Wasm,
        allowBlockingAuxInfo: true
      });
    })();
  }
  return await enginePromise;
}

const MPC_AUX_PRIME_POOL_SIZE = 6;
const MPC_AUX_PRIME_TAKE = 4;
const MPC_AUX_PRIME_GEN_FAILED = 'MPC_AUX_PRIME_GEN_FAILED';
const MPC_AUX_PRIME_TOO_MANY_FAILURES = 'MPC_AUX_PRIME_TOO_MANY_FAILURES';
const MPC_AUX_PRIME_SEED_REQUIRED = 'MPC_AUX_PRIME_SEED_REQUIRED';

export function generateAuxPrimeSeedHex() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateSafePrimesParallel({
  poolSize = MPC_AUX_PRIME_POOL_SIZE,
  take = MPC_AUX_PRIME_TAKE,
  workerCtor = typeof Worker !== 'undefined' ? Worker : null,
  workerUrl = new URL('./mpc-aux-prime-mini-worker.js', import.meta.url),
  seedFactory = generateAuxPrimeSeedHex
} = {}) {
  return new Promise((resolve, reject) => {
    const primes = [];
    let errors = 0;
    const workers = [];
    let settled = false;

    function cleanup() {
      for (const worker of workers) {
        try { worker.terminate(); } catch (_) { /* best-effort */ }
      }
    }

    function settle(resolveValue, rejectValue) {
      if (settled) return;
      settled = true;
      cleanup();
      if (rejectValue) reject(rejectValue);
      else resolve(resolveValue);
    }

    function handleSuccess(prime) {
      if (settled) return;
      primes.push(prime);
      if (primes.length >= take) {
        settle(primes.slice(0, take));
      }
    }

    function handleError(error) {
      if (settled) return;
      errors += 1;
      if (errors > poolSize - take) {
        settle(null, new Error(MPC_AUX_PRIME_TOO_MANY_FAILURES));
      }
    }

    if (typeof workerCtor !== 'function') {
      settle(null, new Error(MPC_AUX_PRIME_GEN_FAILED));
      return;
    }

    for (let i = 0; i < poolSize; i += 1) {
      let worker;
      try {
        worker = new workerCtor(workerUrl, { type: 'module' });
      } catch (error) {
        handleError(error);
        continue;
      }
      workers.push(worker);
      worker.onmessage = (event) => {
        const message = event?.data || {};
        if (message.success && typeof message.prime === 'string') {
          handleSuccess(message.prime);
        } else {
          handleError(new Error(message.error || MPC_AUX_PRIME_GEN_FAILED));
        }
      };
      worker.onerror = (event) => {
        handleError(new Error(event?.message || MPC_AUX_PRIME_GEN_FAILED));
      };
      worker.postMessage({ seed: generateAuxPrimeSeedHex() });
    }

    if (workers.length === 0) {
      settle(null, new Error(MPC_AUX_PRIME_GEN_FAILED));
    }
  });
}

async function handleOperation(operation, payload = {}) {
  const engine = await getEngine();
  const sessionId = String(payload.sessionId || payload.state?.sessionId || '').trim();

  if (operation === 'startAuxInfo') {
    const fanoutStart = Date.now();
    let primes;
    let fanoutStats = null;
    try {
      primes = await generateSafePrimesParallel();
    } catch (fanoutError) {
      fanoutStats = {
        poolSize: MPC_AUX_PRIME_POOL_SIZE,
        take: MPC_AUX_PRIME_TAKE,
        wallMs: Date.now() - fanoutStart,
        successCount: 0,
        failureCount: 1,
        error: fanoutError?.message || String(fanoutError)
      };
      const enriched = new Error(
        `${fanoutError?.message || String(fanoutError)} | fanout=${JSON.stringify(fanoutStats)}`
      );
      throw enriched;
    }
    const state = await engine.startAuxInfo({
      sessionId,
      senderIndex: payload.senderIndex,
      parties: payload.parties,
      curve: payload.curve || 'secp256k1',
      maxSteps: payload.maxSteps,
      requestId: payload.requestId || '',
      primes
    });
    // Surface fan-out stats via a one-shot debug log so SW-side observers
    // can see wall time / poolSize / take without extra IPC. The SW-side
    // `wire-aux-info-completed` audit still records the canonical outcome;
    // this is only the prime-fanout micro-telemetry.
    try {
      logMpcCggmpDebug('cggmp24:aux-prime-fanout', {
        sessionId,
        requestId: String(payload.requestId || ''),
        poolSize: MPC_AUX_PRIME_POOL_SIZE,
        take: MPC_AUX_PRIME_TAKE,
        wallMs: Date.now() - fanoutStart,
        primeCount: Array.isArray(primes) ? primes.length : 0
      });
    } catch (_) { /* debug logging must never fail the start */ }
    return { state: summarizeState(state) };
  }

  if (operation === 'receiveMessage') {
    const state = await engine.receiveMessage({
      sessionId,
      message: payload.message
    });
    return { state: summarizeState(state) };
  }

  if (operation === 'advance') {
    const state = await engine.advance({
      sessionId,
      maxSteps: payload.maxSteps
    });
    return { state: summarizeState(state) };
  }

  if (operation === 'getOutgoingMessages') {
    const messages = await engine.getOutgoingMessages({ sessionId });
    return { messages };
  }

  if (operation === 'getResult') {
    const result = await engine.getResult({ sessionId });
    return { result };
  }

  throw new Error('MPC_AUX_INFO_WORKER_UNSUPPORTED_OPERATION');
}

// Only wire up the worker message loop when running in an actual worker global.
// Guarded so the module can be imported (for unit-testing the exported helpers)
// in environments without `self`/`postMessage` (e.g. Node's test runner).
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async (event) => {
    const message = event?.data || {};
    try {
      const data = await handleOperation(message.operation, message.payload || {});
      self.postMessage({
        id: message.id,
        success: true,
        data
      });
    } catch (error) {
      self.postMessage({
        id: message.id,
        success: false,
        error: error?.message || String(error || '')
      });
    }
  };
}

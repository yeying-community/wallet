import initCggmp24Wasm, { generateAuxPrimeJson } from './background/wasm/cggmp24/mpc_cggmp24_spike.js';

let initPromise = null;
function ensureWasm() {
  if (!initPromise) initPromise = initCggmp24Wasm();
  return initPromise;
}

self.onmessage = async (event) => {
  const seed = String(event?.data?.seed || '').trim();
  if (!seed) {
    self.postMessage({ success: false, error: 'MPC_AUX_PRIME_SEED_REQUIRED' });
    return;
  }
  try {
    await ensureWasm();
    const prime = generateAuxPrimeJson(seed);
    self.postMessage({ success: true, prime });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error?.message || String(error || 'MPC_AUX_PRIME_GEN_FAILED')
    });
  }
};
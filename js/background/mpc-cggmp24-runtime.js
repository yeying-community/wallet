import initCggmp24Wasm, * as cggmp24Wasm from './wasm/cggmp24/mpc_cggmp24_spike.js';
import { installCggmp24WasmEngine } from './mpc-cggmp24-wasm-engine.js';
import { installMpcTssEngine } from './mpc-tss-engine.js';

let installPromise = null;

export async function ensureCggmp24RuntimeInstalled() {
  if (!installPromise) {
    installPromise = (async () => {
      await initCggmp24Wasm();
      return await installCggmp24WasmEngine({
        wasm: cggmp24Wasm,
        setEngine: installMpcTssEngine
      });
    })();
  }
  return await installPromise;
}

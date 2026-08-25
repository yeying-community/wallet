import initCggmp24Wasm, * as cggmp24Wasm from './background/wasm/cggmp24/mpc_cggmp24_spike.js';
import { Cggmp24WasmEngine } from './background/mpc-cggmp24-wasm-engine.js';

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

async function handleOperation(operation, payload = {}) {
  const engine = await getEngine();
  const sessionId = String(payload.sessionId || payload.state?.sessionId || '').trim();

  if (operation === 'startAuxInfo') {
    const state = await engine.startAuxInfo({
      sessionId,
      senderIndex: payload.senderIndex,
      parties: payload.parties,
      curve: payload.curve || 'secp256k1',
      maxSteps: payload.maxSteps,
      requestId: payload.requestId || ''
    });
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

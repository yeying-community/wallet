/**
 * MPC TSS engine adapter boundary.
 *
 * The wallet must not emulate MPC signing with a locally reconstructed private
 * key. A real implementation should plug a browser-safe threshold ECDSA engine
 * here and exchange round messages through mpcService.
 */

class UnconfiguredMpcTssEngine {
  async startKeygen() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async handleKeygenMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async handleSignMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async signTransaction() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async signMessage() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }

  async signTypedData() {
    throw new Error('MPC_TSS_ENGINE_NOT_CONFIGURED');
  }
}

let engine = new UnconfiguredMpcTssEngine();

export function getMpcTssEngine() {
  return engine;
}

export function setMpcTssEngineForTests(nextEngine) {
  engine = nextEngine || new UnconfiguredMpcTssEngine();
}

export function resetMpcTssEngineForTests() {
  engine = new UnconfiguredMpcTssEngine();
}

function normalizeEngineError(error) {
  if (String(error?.message || error || '') === 'MPC_TSS_ENGINE_NOT_CONFIGURED') {
    throw new Error('MPC_SIGNER_NOT_CONFIGURED');
  }
  throw error;
}

export async function startMpcKeygen(input) {
  try {
    return await engine.startKeygen(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function handleMpcKeygenMessage(input) {
  try {
    return await engine.handleKeygenMessage(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function handleMpcSignMessage(input) {
  try {
    return await engine.handleSignMessage(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function signMpcTransaction(input) {
  try {
    return await engine.signTransaction(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function signMpcMessage(input) {
  try {
    return await engine.signMessage(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

export async function signMpcTypedData(input) {
  try {
    return await engine.signTypedData(input);
  } catch (error) {
    normalizeEngineError(error);
  }
}

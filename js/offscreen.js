const KEEP_ALIVE_INTERVAL_MS = 25000;
const MPC_AUX_WORKER_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const MPC_AUX_CHANNEL_NAME = 'yeying-mpc-aux-info';

let mpcAuxChannel = null;
let mpcAuxWorker = null;
const pendingMpcAuxRequests = new Map();

function pingBackground() {
  try {
    chrome.runtime.sendMessage({
      type: 'KEEP_ALIVE',
      timestamp: Date.now()
    });
  } catch (error) {
    // Ignore transient errors when the extension is reloading.
  }
}

pingBackground();
setInterval(pingBackground, KEEP_ALIVE_INTERVAL_MS);

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mpc_aux_worker_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function ensureMpcAuxWorker() {
  if (mpcAuxWorker) return mpcAuxWorker;
  mpcAuxWorker = new Worker(chrome.runtime.getURL('js/mpc-cggmp24-aux-worker.js'), { type: 'module' });
  mpcAuxWorker.onmessage = (event) => {
    const message = event?.data || {};
    const pending = pendingMpcAuxRequests.get(message.id);
    if (!pending) return;
    pendingMpcAuxRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.success) {
      pending.resolve(message.data || {});
    } else {
      pending.reject(new Error(message.error || 'MPC_AUX_INFO_WORKER_FAILED'));
    }
  };
  mpcAuxWorker.onerror = (event) => {
    console.warn('[MPC_AUX_WORKER] worker error', event?.message || event);
    for (const [id, pending] of pendingMpcAuxRequests.entries()) {
      pendingMpcAuxRequests.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error(event?.message || 'MPC_AUX_INFO_WORKER_FAILED'));
    }
  };
  // A structured-clone failure on an inbound worker message would otherwise be
  // silently dropped, stalling aux-info. Reject all pending requests so the
  // error bubbles up to the pump and triggers a generational retry.
  mpcAuxWorker.onmessageerror = (event) => {
    console.warn('[MPC_AUX_WORKER] worker message error', event);
    for (const [id, pending] of pendingMpcAuxRequests.entries()) {
      pendingMpcAuxRequests.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error('MPC_AUX_INFO_WORKER_MESSAGE_ERROR'));
    }
  };
  return mpcAuxWorker;
}

async function requestMpcAuxWorker(operation, payload) {
  const worker = ensureMpcAuxWorker();
  const id = createRequestId();
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMpcAuxRequests.delete(id);
      reject(new Error('MPC_AUX_INFO_WORKER_TIMEOUT'));
    }, MPC_AUX_WORKER_REQUEST_TIMEOUT_MS);
    pendingMpcAuxRequests.set(id, { resolve, reject, timer });
    worker.postMessage({
      id,
      operation,
      payload
    });
  });
}

function initMpcAuxChannel() {
  if (typeof BroadcastChannel === 'undefined' || mpcAuxChannel) return;
  mpcAuxChannel = new BroadcastChannel(MPC_AUX_CHANNEL_NAME);
  mpcAuxChannel.onmessageerror = (event) => {
    // A request that cannot be structured-cloned across the channel is
    // undeliverable. Best-effort notify the requester so it fails fast instead
    // of waiting for the 15-minute request timeout.
    const message = event?.data || {};
    console.warn('[MPC_AUX_WORKER] channel message error', message?.id || '');
    if (message?.id) {
      mpcAuxChannel.postMessage({
        scope: 'mpc-aux-info',
        kind: 'response',
        id: message.id,
        success: false,
        error: 'MPC_AUX_INFO_CHANNEL_MESSAGE_ERROR'
      });
    }
  };
  mpcAuxChannel.onmessage = async (event) => {
    const message = event?.data || {};
    if (message.scope !== 'mpc-aux-info' || message.kind !== 'request') return;
    try {
      const data = await requestMpcAuxWorker(message.operation, message.payload || {});
      mpcAuxChannel.postMessage({
        scope: 'mpc-aux-info',
        kind: 'response',
        id: message.id,
        success: true,
        data
      });
    } catch (error) {
      mpcAuxChannel.postMessage({
        scope: 'mpc-aux-info',
        kind: 'response',
        id: message.id,
        success: false,
        error: error?.message || String(error || '')
      });
    }
  };
}

initMpcAuxChannel();

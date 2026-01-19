import { state } from './state.js';

const OFFSCREEN_URL = 'html/offscreen.html';
let ensurePromise = null;

function hasOffscreenSupport() {
  return Boolean(chrome.offscreen?.createDocument);
}

async function hasOffscreenDocument() {
  try {
    return await chrome.offscreen.hasDocument?.();
  } catch (error) {
    return false;
  }
}

function shouldKeepAlive() {
  if (state.pendingRequests.size > 0) {
    return true;
  }
  return Boolean(state.keyring);
}

export async function ensureOffscreenDocument() {
  if (!hasOffscreenSupport()) {
    return;
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Keep service worker alive for stable wallet connections.'
  }).catch((error) => {
    console.warn('[Background] Failed to create offscreen document:', error);
  }).finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

export async function closeOffscreenDocument() {
  if (!hasOffscreenSupport() || !chrome.offscreen?.closeDocument) {
    return;
  }

  try {
    const hasDoc = await hasOffscreenDocument();
    if (!hasDoc) {
      return;
    }
    await chrome.offscreen.closeDocument();
  } catch (error) {
    console.warn('[Background] Failed to close offscreen document:', error);
  }
}

export async function updateKeepAlive() {
  if (!hasOffscreenSupport()) {
    return;
  }

  if (shouldKeepAlive()) {
    await ensureOffscreenDocument();
  } else {
    await closeOffscreenDocument();
  }
}

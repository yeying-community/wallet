const POPUP_SESSION_STATE_KEY = 'popupWorkspaceState';
const POPUP_SESSION_TTL_MS = 30 * 60 * 1000;

const RESTORABLE_PAGES = new Set([
  'walletPage',
  'accountsPage',
  'settingsPage',
  'sitesPage',
  'contactsPage',
  'transferPage',
  'networkManagePage',
  'networkFormPage',
  'tokenAddPage',
]);

const PAGE_FIELDS = {
  transferPage: ['recipientAddress', 'amount'],
  networkFormPage: [
    'networkEditChainId',
    'networkNameInput',
    'networkRpcInput',
    'networkChainIdInput',
    'networkSymbolInput',
    'networkExplorerInput',
  ],
  tokenAddPage: ['tokenAddressInput'],
  contactsPage: [
    'contactIdInput',
    'contactNameInput',
    'contactAddressInput',
    'contactNoteInput',
  ],
};

function getSessionStorage() {
  return globalThis.chrome?.storage?.session || null;
}

function readFieldValues(pageId, documentRef) {
  const values = {};
  for (const id of PAGE_FIELDS[pageId] || []) {
    const element = documentRef?.getElementById?.(id);
    if (!element || typeof element.value !== 'string') continue;
    values[id] = element.value;
  }
  return values;
}

export function buildPopupSessionState(pageId, documentRef = globalThis.document) {
  if (!RESTORABLE_PAGES.has(pageId)) return null;
  const contactModal = documentRef?.getElementById?.('contactEditorModal');
  return {
    version: 1,
    pageId,
    updatedAt: Date.now(),
    fields: readFieldValues(pageId, documentRef),
    contactEditorOpen: pageId === 'contactsPage' && Boolean(
      contactModal && !contactModal.classList?.contains?.('hidden')
    ),
  };
}

export async function savePopupSessionState(pageId, documentRef = globalThis.document) {
  const storage = getSessionStorage();
  const state = buildPopupSessionState(pageId, documentRef);
  if (!storage || !state) return false;
  await storage.set({ [POPUP_SESSION_STATE_KEY]: state });
  return true;
}

export async function loadPopupSessionState(now = Date.now()) {
  const storage = getSessionStorage();
  if (!storage) return null;
  const result = await storage.get(POPUP_SESSION_STATE_KEY);
  const state = result?.[POPUP_SESSION_STATE_KEY];
  if (
    !state ||
    state.version !== 1 ||
    !RESTORABLE_PAGES.has(state.pageId) ||
    !Number.isFinite(state.updatedAt) ||
    now - state.updatedAt > POPUP_SESSION_TTL_MS
  ) {
    if (state) await storage.remove(POPUP_SESSION_STATE_KEY);
    return null;
  }
  return state;
}

export function applyPopupSessionFields(state, documentRef = globalThis.document) {
  if (!state || !RESTORABLE_PAGES.has(state.pageId)) return false;
  const allowed = new Set(PAGE_FIELDS[state.pageId] || []);
  for (const [id, value] of Object.entries(state.fields || {})) {
    if (!allowed.has(id) || typeof value !== 'string') continue;
    const element = documentRef?.getElementById?.(id);
    if (element && typeof element.value === 'string') element.value = value;
  }
  return true;
}

export async function clearPopupSessionState() {
  const storage = getSessionStorage();
  if (!storage) return;
  await storage.remove(POPUP_SESSION_STATE_KEY);
}

export function bindPopupSessionPersistence({ getCurrentPage, documentRef = globalThis.document } = {}) {
  if (!documentRef?.addEventListener || typeof getCurrentPage !== 'function') return;
  const persist = (event) => {
    const id = event?.target?.id;
    const pageId = getCurrentPage();
    if (!(PAGE_FIELDS[pageId] || []).includes(id)) return;
    void savePopupSessionState(pageId, documentRef).catch(error => {
      console.warn('[PopupSessionState] 保存页面草稿失败:', error);
    });
  };
  documentRef.addEventListener('input', persist);
  documentRef.addEventListener('change', persist);
}

export { POPUP_SESSION_STATE_KEY, POPUP_SESSION_TTL_MS };

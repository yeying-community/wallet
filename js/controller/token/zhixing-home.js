/**
 * 钱包首页:选中「知行图」网络时显示成员状态,而不是余额与通证。
 *
 * 知行图没有资产:不显示转账、添加通证、藏品、活动;切回其他网络时恢复。
 * 状态来自后台 ZHIXING_GET_STATUS(公钥 → 是否成员、账户编号、见习期;链高度),
 * 知行图账户在「账户管理 → 导入钱包」里选「知行图」导入。
 */
import { t } from '../../common/i18n/index.js';

const el = (id) => document.getElementById(id);

// 选中知行图时隐藏的元素(资产相关)
const ASSET_ONLY_IDS = ['transferBtn', 'tokenAddBtn', 'collectiblesTab', 'activityTab'];

export function setZhixingHomeMode(on) {
  for (const id of ASSET_ONLY_IDS) {
    const node = el(id);
    if (node) node.classList.toggle('hidden', !!on);
  }
  if (!on) { const list = el('tokenList'); if (list) delete list.dataset.zhixingHome; }
  if (on) {
    // 回到"通证"页签,其余页签内容隐藏
    el('tokensContent')?.classList.remove('hidden');
    el('collectiblesContent')?.classList.add('hidden');
    el('activityContent')?.classList.add('hidden');
  }
}

function row(label, valueNode) {
  const div = document.createElement('div');
  div.className = 'token-item';
  div.style.display = 'flex';
  div.style.justifyContent = 'space-between';
  div.style.gap = '12px';
  const l = document.createElement('span');
  l.className = 'token-name';
  l.style.flexShrink = '0';      // 长公钥不能把标签挤没
  l.style.whiteSpace = 'nowrap';
  l.textContent = label;
  div.append(l, valueNode);
  return div;
}

function text(t, mono = false) {
  const s = document.createElement('span');
  s.textContent = t;
  if (mono) {
    s.style.fontFamily = 'monospace';
    s.style.wordBreak = 'break-all';
  }
  return s;
}

let lastStatus = null;
let languageListenerBound = false;

/**
 * @param {{ getZhixingStatus: (force?: boolean) => Promise<any> }} wallet
 */
export async function renderZhixingHome(wallet) {
  const list = el('tokenList');
  if (!list) return;
  bindLanguageChange();
  list.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'empty-state';
  loading.textContent = t('zhixing.loading');
  list.appendChild(loading);

  let s = null;
  try {
    s = await wallet.getZhixingStatus();
  } catch (error) {
    s = { error: String(error?.message || error) };
  }
  lastStatus = s;
  drawStatus(s);
}

// 切换界面语言时用上次的状态重画(不重新查询)
function bindLanguageChange() {
  if (languageListenerBound || typeof globalThis.addEventListener !== 'function') return;
  languageListenerBound = true;
  globalThis.addEventListener('wallet-language-changed', () => {
    const list = el('tokenList');
    if (lastStatus && list?.dataset.zhixingHome === '1') drawStatus(lastStatus);
  });
}

function drawStatus(s) {
  const list = el('tokenList');
  if (!list) return;
  list.textContent = '';
  list.dataset.zhixingHome = '1';

  const intro = document.createElement('p');
  intro.className = 'settings-hint';
  intro.style.marginTop = '12px'; // 别被上方的网络选择器盖住
  intro.textContent = t('zhixing.intro');
  list.appendChild(intro);

  if (!s || !s.hasKey) {
    const p = document.createElement('p');
    p.className = 'settings-hint';
    p.textContent = t('zhixing.noAccount');
    list.appendChild(p);
    if (s && s.height) list.appendChild(row(t('zhixing.height'), text(s.height)));
    return;
  }

  list.appendChild(row(t('zhixing.pubkey'), text(s.address, true)));
  let status;
  if (s.error) status = t('zhixing.statusError', { message: s.error });
  else if (!s.member) status = t('zhixing.notMember');
  else status = t('zhixing.member', { id: s.id, stage: t(s.established ? 'zhixing.established' : 'zhixing.probation') });
  list.appendChild(row(t('zhixing.status'), text(status)));
  if (s.height) list.appendChild(row(t('zhixing.height'), text(s.height)));

  if (s.explorer) {
    const a = document.createElement('a');
    a.href = s.explorer;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = t('zhixing.open');
    list.appendChild(row(t('zhixing.explorer'), a));
  }

  // 导出密钥文件的入口在「账户管理 → 账户右侧的 ⋯ 菜单」里——
  // 那是所有链的账户都在的地方,同一个动作只留一个入口。
}

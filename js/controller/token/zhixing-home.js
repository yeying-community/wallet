/**
 * 钱包首页:选中「知行图」网络时显示成员状态,而不是余额与通证。
 *
 * 知行图没有资产:不显示转账、添加通证、藏品、活动;切回其他网络时恢复。
 * 状态来自后台 ZHIXING_GET_STATUS(公钥 → 是否成员、账户编号、见习期;链高度),
 * 知行图账户在「账户管理 → 导入钱包」里选「知行图」导入。
 */
const el = (id) => document.getElementById(id);

// 选中知行图时隐藏的元素(资产相关)
const ASSET_ONLY_IDS = ['transferBtn', 'tokenAddBtn', 'collectiblesTab', 'activityTab'];

export function setZhixingHomeMode(on) {
  for (const id of ASSET_ONLY_IDS) {
    const node = el(id);
    if (node) node.classList.toggle('hidden', !!on);
  }
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

/**
 * @param {{ getZhixingStatus: (force?: boolean) => Promise<any> }} wallet
 */
export async function renderZhixingHome(wallet) {
  const list = el('tokenList');
  if (!list) return;
  list.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'empty-state';
  loading.textContent = '读取知行图状态…';
  list.appendChild(loading);

  let s = null;
  try {
    s = await wallet.getZhixingStatus();
  } catch (error) {
    s = { error: String(error?.message || error) };
  }
  list.textContent = '';

  const intro = document.createElement('p');
  intro.className = 'settings-hint';
  intro.style.marginTop = '12px'; // 别被上方的网络选择器盖住
  intro.textContent = '知行图是记录知识、引用与核验的公开图谱,没有余额与转账。这里显示你的成员身份。';
  list.appendChild(intro);

  if (!s || !s.hasKey) {
    const p = document.createElement('p');
    p.className = 'settings-hint';
    p.textContent = '钱包里还没有知行图账户。到「账户管理 → 导入钱包」选择「知行图」,用助记词或密钥文件导入。';
    list.appendChild(p);
    if (s && s.height) list.appendChild(row('链高度', text(s.height)));
    return;
  }

  list.appendChild(row('公钥', text(s.address, true)));
  let status;
  if (s.error) status = `查询失败:${s.error}`;
  else if (!s.member) status = '还不是成员:把公钥发给邀请你的成员';
  else status = `账户 #${s.id} · ${s.established ? '已过见习期' : '见习期中(核验暂不计入可信度)'}`;
  list.appendChild(row('状态', text(status)));
  if (s.height) list.appendChild(row('链高度', text(s.height)));

  if (s.explorer) {
    const a = document.createElement('a');
    a.href = s.explorer;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '打开知行图 ↗';
    list.appendChild(row('浏览器', a));
  }
}

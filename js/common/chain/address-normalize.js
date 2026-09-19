// @ts-check
/**
 * 跨链族地址规范化（Step 7 收口工具）
 *
 * 阶段 0 之后，`account.address` 在 EVM 账户上是 `0x<40hex>`，但允许被改成
 * 任意链族的原生形态——目前已知有：
 *   - 'eip155' / 'evm'：EVM 形态，0x + 20 字节（40 hex），大小写等价（小写）
 *   - 'tron'     ：Tron 形态，Base58Check 编码，前缀 T...（34 字符），**大小写敏感**
 *
 * 仓库里 ~25 个旧调用点用 `account.address.toLowerCase()` / `/^0x[a-f0-9]{40}$/`
 * 做匹配或校验。把它们切到本工具，统一按链族处理：
 *   - normalizeAddress(value, family): 返回该链族的"规范形态"字符串。EVM → `0x<40小写>`，
 *     Tron → 原始 Base58（保持原大小写）。无效输入返回空串。
 *   - isValidAddressForFamily(value, family): 不改大小写的真伪校验。EVM 大小写都接受，
 *     Tron 走字符集 + 校验和（解 Base58Check）。
 *   - compareAddresses(a, b, family): 等价比较。EVM 走小写；Tron 走原值。
 *   - formatAddressForFamily(value, family): 用于 display/QR。EVM 还原成 EIP-55 checksum
 *     或原样；Tron 原样。
 *   - addressDidMethod(family): DID 前缀（'eth' | 'tron'），用于构造 `did:pkh:<method>:<addr>`。
 *
 * 调用方约定：account 对象必须带 `namespace` 字段（来自 buildAccountIdentity），
 * 否则本工具默认按 EVM 处理（与阶段 0 行为一致，向后兼容）。
 *
 * Tron 的 Base58Check 严格校验通过 `registerTronStrictValidator(fn)` 注入；
 * 该函数由 Tron adapter 模块（`js/chain/adapters/tron/...`）在加载时注册。
 * 这样 common/ 不依赖 chain/，避免层间反向依赖。注入前 Tron 路径仅做
 * 字符集粗校验（保持 Step 7 迁移期可用性）。
 */

const EVM_REGEX = /^0x[0-9a-fA-F]{40}$/;
const TRON_PLAIN_REGEX = /^[A-HJ-NP-Za-km-z1-9]{34}$/;
const SOLANA_PLAIN_REGEX = /^[A-HJ-NP-Za-km-z1-9]{32,44}$/;  // base58(32B) ≈ 43-44 字符
// Bitcoin：base58 (P2PKH/P2SH，前缀 1/3/m/n/2) 或 bech32/bech32m (bc1/tb1)。
// 粗字符集/前缀预校验；严格校验（校验和 / bech32 polymod）走注入的 validator。
const BITCOIN_PLAIN_REGEX = /^(bc1|tb1)[0-9ac-hj-np-z]{6,87}$|^[123mn2][A-HJ-NP-Za-km-z1-9]{25,39}$/;

let _tronStrictValidator = null;
let _solanaStrictValidator = null;
let _bitcoinStrictValidator = null;

export function registerTronStrictValidator(fn) {
  _tronStrictValidator = typeof fn === 'function' ? fn : null;
}

export function registerSolanaStrictValidator(fn) {
  _solanaStrictValidator = typeof fn === 'function' ? fn : null;
}

export function registerBitcoinStrictValidator(fn) {
  _bitcoinStrictValidator = typeof fn === 'function' ? fn : null;
}

/**
 * 链族感知的 address 规范化。EVM 转小写，Tron 保持 Base58 大小写敏感。
 * 用 `normalizeAddressForFamily` 名称导出（与 address-utils.js 的 `normalizeAddress`
 * 不冲突）。
 */
export function normalizeAddressForFamily(value, family = DEFAULT_ADDRESS_FAMILY) {
  return normalizeAddress(value, family);
}

/**
 * 默认链族：向后兼容，未显式标注的 account 视作 EVM。
 */
export const DEFAULT_ADDRESS_FAMILY = 'eip155';

function normalizeAddress(value, family = DEFAULT_ADDRESS_FAMILY) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ns = String(family || '').toLowerCase();
  if (ns === 'tron') {
    if (!TRON_PLAIN_REGEX.test(raw)) return '';
    if (_tronStrictValidator && !_tronStrictValidator(raw)) return '';
    // 严格校验通过：保持原 Base58 大小写（Tron 大小写敏感）
    return raw;
  }
  if (ns === 'solana') {
    if (!SOLANA_PLAIN_REGEX.test(raw)) return '';
    if (_solanaStrictValidator && !_solanaStrictValidator(raw)) return '';
    return raw;
  }
  if (ns === 'utxo' || ns === 'bip122') {
    // Bitcoin 大小写敏感（base58）/ bech32 强制小写；保持原值。
    if (!BITCOIN_PLAIN_REGEX.test(raw)) return '';
    if (_bitcoinStrictValidator && !_bitcoinStrictValidator(raw)) return '';
    return raw;
  }
  // 默认 EVM：转小写并校验
  const lowered = raw.toLowerCase();
  if (!EVM_REGEX.test(lowered)) return '';
  return lowered;
}

export function isValidAddressForFamily(value, family = DEFAULT_ADDRESS_FAMILY) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const ns = String(family || '').toLowerCase();
  if (ns === 'tron') {
    if (!TRON_PLAIN_REGEX.test(raw)) return false;
    if (_tronStrictValidator) return _tronStrictValidator(raw);
    // 严格校验函数未注册：仅字符集通过（Step 7 迁移期回退）
    return true;
  }
  if (ns === 'solana') {
    if (!SOLANA_PLAIN_REGEX.test(raw)) return false;
    if (_solanaStrictValidator) return _solanaStrictValidator(raw);
    // 严格校验函数未注册（如 popup 上下文未加载 solana adapter）：
    // 回退到字符集校验（与 Tron 迁移期回退一致）。background 侧已注册严格校验。
    return true;
  }
  if (ns === 'utxo' || ns === 'bip122') {
    if (!BITCOIN_PLAIN_REGEX.test(raw)) return false;
    if (_bitcoinStrictValidator) return _bitcoinStrictValidator(raw);
    // 同上：popup 未加载 bip122 adapter 时回退字符集/前缀校验。
    return true;
  }
  return EVM_REGEX.test(raw);
}

export function compareAddresses(a, b, family = DEFAULT_ADDRESS_FAMILY) {
  const na = normalizeAddress(a, family);
  const nb = normalizeAddress(b, family);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * 把 address 还原成原始链形态字符串，供 display/QR 使用。
 * - EVM: 若原值是 EIP-55 checksum 形式，则优先保留 checksum；否则小写
 * - Tron: 原样
 */
export function formatAddressForFamily(value, family = DEFAULT_ADDRESS_FAMILY) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ns = String(family || '').toLowerCase();
  if (ns === 'tron') return raw;
  if (!EVM_REGEX.test(raw)) return raw;
  const lower = raw.toLowerCase();
  if (raw === lower) return raw;
  // 其他大小写形式按小写返回，避免展示错误（不依赖 ethers.getAddress 以免循环依赖）
  return lower;
}

/**
 * 链族对应的 did:pkh 方法名。
 * - 'eip155' → 'eth'（CAIP-10 / EIP-3770 习惯命名）
 * - 'tron'  → 'tron'
 */
export function addressDidMethod(family = DEFAULT_ADDRESS_FAMILY) {
  const ns = String(family || '').toLowerCase();
  if (ns === 'tron') return 'tron';
  return 'eth';
}

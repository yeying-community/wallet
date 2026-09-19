/**
 * YeYing Wallet - 通证操作
 * 负责：ETH 余额、添加自定义代币、代币余额列表
 */
import { validateEthereumAddress, validateTokenConfig } from '../../config/validation-rules.js';
import { handleRpcMethod } from '../rpc-handler.js';
import { getUserSetting, updateUserSetting } from '../../storage/index.js';
import { LIMITS, BUILTIN_TOKENS_BY_CHAIN_ID, BUILTIN_TOKENS_BY_CHAIN_KEY } from '../../config/index.js';
import { getCurrentEvmChainIdHex } from '../../chain/current-chain.js';
import { getCurrentChainKey } from '../../chain/current-chain.js';
import { getAdapter } from '../../chain/registry.js';
import { normalizeAddressForFamily, compareAddresses } from '../../common/chain/address-normalize.js';

const CUSTOM_TOKENS_KEY = 'custom_tokens';

// family → 原生币小数位（native balance 展示用）
const NATIVE_DECIMALS = { eip155: 18, tron: 6, solana: 9, utxo: 8 };

function getCurrentTokenChainId() {
  try {
    return getCurrentEvmChainIdHex();
  } catch {
    return '0x1';
  }
}

/**
 * 当前 CAIP-2 chainKey（异常时兜底 eip155:1）。
 * @returns {string}
 */
function currentChainKey() {
  try {
    return getCurrentChainKey();
  } catch {
    return 'eip155:1';
  }
}

/**
 * chainId / chainKey → family。
 * 接受 hex/decimal chainId（EVM）或 CAIP-2 chainKey（tron:/solana:/bip122:）。
 */
function chainIdToFamily(chainIdOrKey) {
  const s = String(chainIdOrKey || '');
  if (s.startsWith('tron:')) return 'tron';
  if (s.startsWith('solana:')) return 'solana';
  if (s.startsWith('bip122:')) return 'utxo';
  return 'eip155';
}

function mergeTokenLists(builtinTokens, customTokens, family = 'eip155') {
  // EVM 保持 `.toLowerCase()` 去重（既有行为）；非 EVM 按链族规范化地址
  // （Tron/Solana 地址大小写敏感，不能 lowercase）。
  const byAddress = new Map();
  [...(builtinTokens || []), ...(customTokens || [])].forEach((token) => {
    const raw = token?.address;
    if (!raw) return;
    const address = family === 'eip155'
      ? String(raw).toLowerCase()
      : (normalizeAddressForFamily(raw, family) || String(raw));
    if (!address) return;
    const previous = byAddress.get(address) || {};
    byAddress.set(address, {
      ...previous,
      ...token,
      address
    });
  });
  return Array.from(byAddress.values());
}

function formatEtherForDisplay(balanceHex, decimals = 4) {
  try {
    if (!balanceHex) return '0.0000';
    const wei = BigInt(balanceHex);
    const base = 10n ** 18n;
    const integer = wei / base;
    const fraction = wei % base;
    if (decimals <= 0) {
      return integer.toString();
    }
    const fractionStr = fraction.toString().padStart(18, '0');
    const displayFraction = fractionStr.slice(0, decimals).padEnd(decimals, '0');
    return `${integer.toString()}.${displayFraction}`;
  } catch (error) {
    return '0.0000';
  }
}

function formatTokenBalance(balanceHex, decimals = 18, displayDecimals = 4) {
  try {
    if (!balanceHex) return '0';
    const value = BigInt(balanceHex);
    const base = 10n ** BigInt(decimals);
    const integer = value / base;
    const fraction = value % base;

    if (displayDecimals <= 0) {
      return integer.toString();
    }

    const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, displayDecimals);
    let formatted = `${integer.toString()}.${fractionStr}`;
    formatted = formatted.replace(/\.?0+$/, '');
    return formatted || '0';
  } catch (error) {
    return '0';
  }
}

/**
 * 通用原生币小数展示：raw 可为 '0x<hex>'（Tron）或十进制字符串（Solana lamports）。
 * 固定展示 displayDecimals 位（补零），与 formatEtherForDisplay 形态对齐。
 */
function formatNativeUnits(raw, decimals = 18, displayDecimals = 4) {
  try {
    if (raw === null || raw === undefined || raw === '') return (0).toFixed(displayDecimals);
    const value = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const integer = value / base;
    const fraction = value % base;
    if (displayDecimals <= 0) {
      return integer.toString();
    }
    const fractionStr = fraction.toString().padStart(decimals, '0');
    const displayFraction = fractionStr.slice(0, displayDecimals).padEnd(displayDecimals, '0');
    return `${integer.toString()}.${displayFraction}`;
  } catch {
    return (0).toFixed(displayDecimals);
  }
}

async function getTokenBalanceHex(tokenAddress, accountAddress) {
  const normalizedToken = tokenAddress?.toLowerCase();
  const normalizedAccount = accountAddress?.toLowerCase();
  if (!normalizedToken || !normalizedAccount) {
    throw new Error('invalid token or account');
  }

  const addressData = normalizedAccount.replace(/^0x/, '').padStart(64, '0');
  const data = `0x70a08231${addressData}`;

  return handleRpcMethod('eth_call', [
    {
      to: normalizedToken,
      data
    },
    'latest'
  ]);
}

/**
 * 获取余额（按当前 chainKey 调度）
 * - EVM：eth_getBalance（wei → ether 4 位小数）
 * - Tron：adapter.getNativeBalance（sun → 6 位小数）
 * - Solana：adapter.getNativeBalance（lamports → 9 位小数）
 * - UTXO (BTC)：adapter.getNativeBalance（satoshi → 8 位小数）
 *
 * @param {string} address
 * @returns {Promise<Object>} { success, balance }
 */
export async function handleGetBalance(address) {
  if (!address) {
    return { success: false, error: 'address is required' };
  }

  const chainKey = currentChainKey();
  const family = chainIdToFamily(chainKey);

  try {
    if (family === 'eip155') {
      const addressValidation = validateEthereumAddress(address);
      if (!addressValidation.valid) {
        return { success: false, error: addressValidation.error || 'invalid address' };
      }
      const balanceHex = await handleRpcMethod('eth_getBalance', [address, 'latest']);
      const balance = formatEtherForDisplay(balanceHex, 4);
      return { success: true, balance };
    }
    let adapter = null;
    try { adapter = getAdapter(chainKey); } catch { adapter = null; }
    if (!adapter || typeof adapter.getNativeBalance !== 'function') {
      return { success: false, error: `No native balance adapter for ${chainKey}` };
    }
    const decimals = NATIVE_DECIMALS[family] ?? 18;
    const r = await adapter.getNativeBalance(address, { chainKey });
    const balance = formatNativeUnits(r?.balance ?? '0', decimals, 4);
    return { success: true, balance };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get balance' };
  }
}

/**
 * 添加通证
 * @param {Object} token
 * @returns {Promise<Object>} { success, token }
 */
export async function handleAddToken(token) {
  if (!token || typeof token !== 'object') {
    return { success: false, error: 'token is required' };
  }

  const validation = validateTokenConfig(token);
  if (!validation.valid) {
    return { success: false, error: validation.errors?.[0] || 'invalid token' };
  }

  const family = chainIdToFamily(token.chainId || currentChainKey());
  // v1 自定义 token 仅 EVM：Tron/Solana/BTC 都拒绝添加。
  if (family !== 'eip155') {
    return { success: false, error: `addToken not supported for family ${family} (v1 supports EVM only)` };
  }
  const chainId = token.chainId || getCurrentTokenChainId();
  const normalizedAddress = String(token.address || '').toLowerCase();
  const decimals = Number.isFinite(token.decimals)
    ? token.decimals
    : parseInt(token.decimals ?? '18', 10);

  const normalizedToken = {
    address: normalizedAddress,
    symbol: token.symbol,
    name: token.name || token.symbol,
    decimals: Number.isFinite(decimals) ? decimals : 18,
    image: token.image || null,
    chainId
  };

  try {
    const allTokens = await getUserSetting(CUSTOM_TOKENS_KEY, {});
    const list = Array.isArray(allTokens[chainId]) ? [...allTokens[chainId]] : [];
    const existingIndex = list.findIndex(item => (
      compareAddresses(item?.address, normalizedAddress, family)
    ));

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...normalizedToken };
    } else {
      if (list.length >= LIMITS.MAX_TOKENS_PER_ACCOUNT) {
        return { success: false, error: 'token limit reached' };
      }
      list.push(normalizedToken);
    }

    allTokens[chainId] = list;
    await updateUserSetting(CUSTOM_TOKENS_KEY, allTokens);

    return { success: true, token: normalizedToken };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to add token' };
  }
}

/**
 * 获取通证余额列表
 * - EVM (eip155)：既有路径走 `getTokenBalanceHex`（ERC-20 balanceOf）
 * - Tron (tron)：调 adapter.getTokenBalance（triggerconstantcontract balanceOf）
 * - Solana (solana)：调 adapter.getTokenBalance（getTokenAccountsByOwner）
 * - UTXO (bip122)：无 token 概念，返回 []
 * @param {string} address
 * @returns {Promise<Object>} { success, tokens }
 */
export async function handleGetTokenBalances(address) {
  if (!address) {
    return { success: false, error: 'address is required' };
  }

  const chainKey = currentChainKey();
  const family = chainIdToFamily(chainKey);
  const isEvm = family === 'eip155';

  if (!isEvm) {
    const addressValidation = validateEthereumAddress(address);
    if (!addressValidation.valid) {
      // 非 EVM 不用 validateEthereumAddress；改成只做非空校验。
      if (typeof address !== 'string' || !address.trim()) {
        return { success: false, error: addressValidation.error || 'invalid address' };
      }
    }
  } else {
    const addressValidation = validateEthereumAddress(address);
    if (!addressValidation.valid) {
      return { success: false, error: addressValidation.error || 'invalid address' };
    }
  }

  try {
    if (family === 'utxo') {
      // Bitcoin 不上稳定币，token 列表恒空。
      return { success: true, tokens: [] };
    }

    const builtinTokens = Array.isArray(BUILTIN_TOKENS_BY_CHAIN_KEY[chainKey])
      ? BUILTIN_TOKENS_BY_CHAIN_KEY[chainKey]
      : [];
    let customTokens = [];
    if (isEvm) {
      const evmChainId = getCurrentTokenChainId();
      const allTokens = await getUserSetting(CUSTOM_TOKENS_KEY, {});
      customTokens = Array.isArray(allTokens[evmChainId]) ? allTokens[evmChainId] : [];
    }
    const tokens = mergeTokenLists(builtinTokens, customTokens, family);

    if (tokens.length === 0) {
      return { success: true, tokens: [] };
    }

    let adapter = null;
    try { adapter = getAdapter(chainKey); } catch { adapter = null; }

    const balances = await Promise.all(tokens.map(async (token) => {
      try {
        let balanceRaw = null;
        if (isEvm) {
          balanceRaw = await getTokenBalanceHex(token.address, address);
        } else if (adapter && typeof adapter.getTokenBalance === 'function') {
          const r = await adapter.getTokenBalance(address, { address: token.address }, { chainKey });
          balanceRaw = r?.balance ?? null;
        } else {
          balanceRaw = null;
        }
        if (balanceRaw === null || balanceRaw === undefined) {
          return { ...token, balance: '0' };
        }
        const balance = formatTokenBalance(balanceRaw, token.decimals ?? 18, 4);
        return { ...token, balance };
      } catch (error) {
        return { ...token, balance: '0' };
      }
    }));

    return { success: true, tokens: balances };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get token balances' };
  }
}

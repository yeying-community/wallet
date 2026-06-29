/**
 * YeYing Wallet - 通证操作
 * 负责：ETH 余额、添加自定义代币、代币余额列表
 */
import { state } from '../state.js';
import { normalizeChainId } from '../../common/chain/index.js';
import { validateEthereumAddress, validateTokenConfig } from '../../config/validation-rules.js';
import { handleRpcMethod } from '../rpc-handler.js';
import { getUserSetting, updateUserSetting } from '../../storage/index.js';
import { LIMITS, BUILTIN_TOKENS_BY_CHAIN_ID } from '../../config/index.js';

const CUSTOM_TOKENS_KEY = 'custom_tokens';

function getCurrentTokenChainId() {
  const chainId = state.currentChainId || '0x1';
  try {
    return normalizeChainId(chainId);
  } catch {
    return chainId;
  }
}

function mergeTokenLists(builtinTokens, customTokens) {
  const byAddress = new Map();
  [...(builtinTokens || []), ...(customTokens || [])].forEach((token) => {
    const address = token?.address?.toLowerCase();
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
 * 获取余额（ETH）
 * @param {string} address
 * @returns {Promise<Object>} { success, balance }
 */
export async function handleGetBalance(address) {
  if (!address) {
    return { success: false, error: 'address is required' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'invalid address' };
  }

  try {
    const balanceHex = await handleRpcMethod('eth_getBalance', [address, 'latest']);
    const balance = formatEtherForDisplay(balanceHex, 4);
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

  const chainId = token.chainId || getCurrentTokenChainId();
  const normalizedAddress = token.address.toLowerCase();
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
    const existingIndex = list.findIndex(item => item?.address?.toLowerCase() === normalizedAddress);

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
 * @param {string} address
 * @returns {Promise<Object>} { success, tokens }
 */
export async function handleGetTokenBalances(address) {
  if (!address) {
    return { success: false, error: 'address is required' };
  }

  const addressValidation = validateEthereumAddress(address);
  if (!addressValidation.valid) {
    return { success: false, error: addressValidation.error || 'invalid address' };
  }

  const chainId = getCurrentTokenChainId();

  try {
    const allTokens = await getUserSetting(CUSTOM_TOKENS_KEY, {});
    const customTokens = Array.isArray(allTokens[chainId]) ? allTokens[chainId] : [];
    const builtinTokens = Array.isArray(BUILTIN_TOKENS_BY_CHAIN_ID[chainId])
      ? BUILTIN_TOKENS_BY_CHAIN_ID[chainId]
      : [];
    const tokens = mergeTokenLists(builtinTokens, customTokens);

    if (tokens.length === 0) {
      return { success: true, tokens: [] };
    }

    const balances = await Promise.all(tokens.map(async (token) => {
      try {
        const balanceHex = await getTokenBalanceHex(token.address, address);
        const balance = formatTokenBalance(balanceHex, token.decimals ?? 18, 4);
        return {
          ...token,
          balance
        };
      } catch (error) {
        return {
          ...token,
          balance: '0'
        };
      }
    }));

    return { success: true, tokens: balances };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get token balances' };
  }
}

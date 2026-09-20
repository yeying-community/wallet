// @ts-check
/**
 * Tron 地址派生（secp256k1 / coin type 195）
 *
 * 复用 ethers vendored：私钥 → SigningKey → 64 字节 uncompressed pubkey（去掉 0x04 前缀）
 * → keccak256 → 取最后 20 字节 → 0x41 prefix → Base58Check → 34 字符地址。
 *
 * 与 EVM 路径共享同一条 secp256k1 曲线，仅 derivation path 不同（m/44'/195' vs m/44'/60'）。
 * 因此本地签名复用 signing-service 的 local-keyring signer（见 Step 6）。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';
import {
  trxBase58CheckEncode,
  trxBase58CheckDecode,
  trxBase58CheckVerify
} from './base58check.js';
import { registerTronStrictValidator } from '../../../common/chain/address-normalize.js';
import {
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE,
  isValidTronReference,
  chainKeyFromTronNetwork,
  tronReference
} from './chain-key-bridge.js';

// 重新导出 namespace 常量，方便调用方直接 `import { TRON_NAMESPACE } from 'address.js'`。
export {
  TRON_NAMESPACE,
  TRON_REFERENCE_MAINNET,
  TRON_REFERENCE_SHASTA,
  TRON_REFERENCE_NILE,
  isValidTronReference,
  chainKeyFromTronNetwork,
  tronReference
};

// common/chain/address-normalize.js 的 Tron 严格校验走注入模式；
// 此模块加载时主动注册（一次即可，重复注册幂等）。
registerTronStrictValidator(trxBase58CheckVerify);

// ===== 地址 prefix 常量 =====
export const TRON_ADDRESS_PREFIX_MAINNET = 0x41;
export const TRON_ADDRESS_PREFIX_TESTNET = 0xa0;

// ===== BIP-44 派生常量 =====
export const TRON_COIN_TYPE = 195;
export const TRON_DERIVATION_PATH = (index = 0) => `m/44'/195'/0'/0/${index}`;

/**
 * 从 secp256k1 uncompressed pubkey（0x + 130 hex / 含 0x04 前缀）派生 Tron 地址。
 *
 * 流程：uncompressed[64B] → keccak256 → 取最后 20B → 拼 prefix → Base58Check。
 *
 * @param {string|Uint8Array} uncompressedPubKeyHexOrBytes
 * @param {number} [prefix] 默认 0x41 (mainnet)
 * @returns {string} Base58Check 地址（mainnet 形如 T...）
 */
export function pubkeyToTronAddress(uncompressedPubKeyHexOrBytes, prefix = TRON_ADDRESS_PREFIX_MAINNET) {
  let bytes;
  if (typeof uncompressedPubKeyHexOrBytes === 'string') {
    const hex = uncompressedPubKeyHexOrBytes.startsWith('0x')
      ? uncompressedPubKeyHexOrBytes.slice(2)
      : uncompressedPubKeyHexOrBytes;
    if (hex.length !== 130) {
      throw new Error(`Tron pubkey must be 130 chars (0x04 + 64B); got ${hex.length}`);
    }
    bytes = ethers.getBytes('0x' + hex.slice(2));
  } else if (uncompressedPubKeyHexOrBytes instanceof Uint8Array) {
    bytes = uncompressedPubKeyHexOrBytes;
  } else {
    throw new TypeError('pubkeyToTronAddress expects hex string or Uint8Array');
  }
  if (bytes.length !== 64) {
    throw new Error(`Tron pubkey must be 64 bytes (no 0x04 prefix); got ${bytes.length}`);
  }
  const hash = ethers.keccak256(bytes);
  const last20 = ethers.getBytes(ethers.dataSlice(hash, -20));
  return trxBase58CheckEncode(last20, prefix);
}

/**
 * 从私钥 hex 派生 Tron 地址。
 * @param {string} privateKeyHex 0x + 64 hex chars (32B)
 * @param {number} [prefix]
 * @returns {string}
 */
export function privateKeyToTronAddress(privateKeyHex, prefix = TRON_ADDRESS_PREFIX_MAINNET) {
  const key = String(privateKeyHex || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('privateKeyToTronAddress expects 0x + 64 hex chars');
  }
  const sk = new ethers.SigningKey(key);
  return pubkeyToTronAddress(sk.publicKey, prefix);
}

/**
 * 校验 Tron 地址字符串（Base58Check 解码 + prefix 校验 + checksum 校验）。
 * @param {string} value
 * @returns {boolean}
 */
export function isValidTronAddress(value) {
  return trxBase58CheckVerify(String(value || '').trim());
}

/**
 * 校验是否是给定 reference 的合法地址（mainnet 仅接受 0x41 prefix；
 * shasta/nile 接受 0xa0）。
 *
 * @param {string} value
 * @param {string} reference mainnet | shasta | nile
 * @returns {boolean}
 */
export function isValidTronAddressForReference(value, reference) {
  if (!isValidTronReference(reference)) return false;
  const raw = String(value || '').trim();
  if (!trxBase58CheckVerify(raw)) return false;
  try {
    const hash = trxBase58CheckDecode(raw);
    if (hash.length !== 20) return false;
    // 重新编码用 reference 对应 prefix，对比原串
    const expectedPrefix = reference === TRON_REFERENCE_MAINNET
      ? TRON_ADDRESS_PREFIX_MAINNET
      : TRON_ADDRESS_PREFIX_TESTNET;
    return trxBase58CheckEncode(hash, expectedPrefix) === raw;
  } catch {
    return false;
  }
}

/**
 * reference → 前缀字节（mainnet 0x41；testnet 0xa0）。
 */
export function tronPrefixForReference(reference) {
  if (!isValidTronReference(reference)) throw new Error(`Invalid tron reference: ${reference}`);
  return reference === TRON_REFERENCE_MAINNET
    ? TRON_ADDRESS_PREFIX_MAINNET
    : TRON_ADDRESS_PREFIX_TESTNET;
}

/**
 * 通过 HDNode（m/44'/195'/0'/0/{index}）派生子私钥 hex。
 *
 * ethers 的 HDNodeWallet.fromPhrase 默认深度已是 m/44'/60'/0'/0/0，因此传相对路径
 * 即可；为了和 EVM 路径不冲突，这里手动用 derivePath 走 tron 完整路径——相对路径
 * 写法 `44'/195'/0'/0/{index}`。
 *
 * @param {string} mnemonic
 * @param {number} index
 * @returns {string} 0x + 64 hex chars
 */
export function deriveTronChildPrivateKey(mnemonic, index = 0) {
  const hd = ethers.HDNodeWallet.fromPhrase(String(mnemonic || '').trim());
  // 从 m/44'/60'/0'/0/0 派生到 m/44'/195'/0'/0/{index} 需切币种到 Tron 的相对路径：
  //   从 44'/60'/0'/0/0 → 44'/195'/0'/0/{index} 需要 derivePath("44'/195'/0'/0/{index}")
  // ethers 接受相对路径。
  const relative = String(index).padStart(2, '0');
  const child = hd.derivePath(`44'/195'/0'/0/${index}`);
  return child.privateKey;
}
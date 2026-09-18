// @ts-check
/**
 * EVM 地址工具（从 signing.js 忠实搬迁）
 *
 * normalizeAddress 语义与旧实现逐字节一致：合法则返回小写 checksum 地址，
 * 非法返回空串（不抛错）——调用方靠空串判定无效。
 */

import { ethers } from '../../../../lib/ethers-6.16.esm.min.js';

/**
 * 归一化为小写地址；非法返回空串。
 * @param {*} value
 * @returns {string}
 */
export function normalizeAddress(value) {
  const address = String(value || '').trim();
  return ethers.isAddress(address) ? ethers.getAddress(address).toLowerCase() : '';
}

/**
 * 是否为合法 EVM 地址。
 * @param {string} addr
 * @returns {boolean}
 */
export function isValidAddress(addr) {
  return ethers.isAddress(String(addr || '').trim());
}

/**
 * 展示用地址（EIP-55 checksum）；非法返回原值。
 * @param {string} addr
 * @returns {string}
 */
export function displayAddress(addr) {
  const trimmed = String(addr || '').trim();
  return ethers.isAddress(trimmed) ? ethers.getAddress(trimmed) : trimmed;
}

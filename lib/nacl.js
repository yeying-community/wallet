/**
 * TweetNaCl init helper — 在浏览器/SW/popup 等全局 self.crypto 可用的环境里
 * 是 no-op（TweetNaCl 自带的 IIFE init 会抓到 self.crypto.getRandomValues）；
 * 在 Node / 老环境中，TweetNaCl 找不到 self.crypto → 抛 'no PRNG'。
 *
 * 本模块导入 nacl 后主动 setPRNG（用 globalThis.crypto.getRandomValues 或
 * 简单 xorshift fallback），保证 ed25519 keypair 生成 / 签名都跑得通。
 *
 * 用法：import './lib/nacl-init.js'; import nacl from './lib/tweetnacl.esm.js';
 */
import nacl from './tweetnacl.esm.js';

if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
  nacl.setPRNG((out, n) => {
    const buf = new Uint8Array(n);
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out[i] = buf[i];
  });
} else {
  // Fallback (NOT cryptographically secure; only used when no PRNG is available
  // — e.g. legacy test environments without globalThis.crypto).
  let _seed = 0x9e3779b9 ^ Date.now();
  nacl.setPRNG((out, n) => {
    for (let i = 0; i < n; i++) {
      _seed ^= _seed << 13;
      _seed ^= _seed >>> 17;
      _seed ^= _seed << 5;
      out[i] = _seed & 0xff;
    }
  });
}

export default nacl;
// @ts-check
/**
 * 解开知行图的密钥文件(Web3 Secret Storage v3):`node keygen --encrypt` 与 `node encrypt-key` 写的格式。
 *
 * 格式与节点完全一致(node/src/keystore.rs):
 *   kdf    = scrypt(n=2^18, r=8, p=1) → 32 字节
 *   cipher = aes-128-ctr,密钥是派生的前 16 字节,iv 是 16 字节
 *   mac    = Keccak256(derived[16..32] ‖ ciphertext)
 *
 * 浏览器与扩展都没有内置 scrypt 和 Keccak-256,所以这里是纯 JS 实现:
 *   - Keccak-256:以太坊用的原始 Keccak(不是 SHA3-256),对照官方向量检验;
 *   - scrypt:RFC 7914,n=2^18 时约需 256 MB 内存,桌面浏览器几秒到十几秒。
 * 参数上限与浏览器的实现一致,防止恶意文件把浏览器拖垮。
 */
const enc = new TextEncoder();

export function hexToBytes(hex) {
  const h = String(hex || '').replace(/^0x/i, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new Error('ZHIXING_BAD_HEX');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b) {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- Keccak-256 与 scrypt ---------------------------------------------------------
// 以下逐字取自知行图的参考签名器(yeying-community/blockchain tools/explorer/reference/signer.js),
// 那里由 signer.test.mjs 对照 Keccak 官方向量、RFC 7914 向量与 Rust 节点生成的密钥文件检验过。
// 这是一份拷贝:改动请先在参考实现那边改并通过检验,再同步过来,不要在这里单独改写。


const KECCAK_RC = [
  "0x0000000000000001", "0x0000000000008082", "0x800000000000808a", "0x8000000080008000",
  "0x000000000000808b", "0x0000000080000001", "0x8000000080008081", "0x8000000000008009",
  "0x000000000000008a", "0x0000000000000088", "0x0000000080008009", "0x000000008000000a",
  "0x000000008000808b", "0x800000000000008b", "0x8000000000008089", "0x8000000000008003",
  "0x8000000000008002", "0x8000000000000080", "0x000000000000800a", "0x800000008000000a",
  "0x8000000080008081", "0x8000000000008080", "0x0000000080000001", "0x8000000080008008",
].map(BigInt);
// 旋转位数 ROT[x + 5y]
const KECCAK_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rot64 = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M64);

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rot64(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rot64(s[x + 5 * y], KECCAK_ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        s[x + 5 * y] = B[x + 5 * y] ^ ((M64 ^ B[(x + 1) % 5 + 5 * y]) & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= KECCAK_RC[round];
  }
}

/** Keccak-256(以太坊 / Web3 密钥文件用的原始 Keccak,填充 0x01,不是 SHA3-256 的 0x06)。 */
export function keccak256(msg) {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(msg.length / rate) * rate + rate);
  padded.set(msg);
  padded[msg.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((s[i] >> BigInt(8 * b)) & 0xffn);
  return out;
}

function salsa20_8(B) {
  let x0 = B[0], x1 = B[1], x2 = B[2], x3 = B[3], x4 = B[4], x5 = B[5], x6 = B[6], x7 = B[7],
    x8 = B[8], x9 = B[9], x10 = B[10], x11 = B[11], x12 = B[12], x13 = B[13], x14 = B[14], x15 = B[15], t;
  for (let i = 0; i < 8; i += 2) {
    t = (x0 + x12) | 0; x4 ^= (t << 7) | (t >>> 25); t = (x4 + x0) | 0; x8 ^= (t << 9) | (t >>> 23);
    t = (x8 + x4) | 0; x12 ^= (t << 13) | (t >>> 19); t = (x12 + x8) | 0; x0 ^= (t << 18) | (t >>> 14);
    t = (x5 + x1) | 0; x9 ^= (t << 7) | (t >>> 25); t = (x9 + x5) | 0; x13 ^= (t << 9) | (t >>> 23);
    t = (x13 + x9) | 0; x1 ^= (t << 13) | (t >>> 19); t = (x1 + x13) | 0; x5 ^= (t << 18) | (t >>> 14);
    t = (x10 + x6) | 0; x14 ^= (t << 7) | (t >>> 25); t = (x14 + x10) | 0; x2 ^= (t << 9) | (t >>> 23);
    t = (x2 + x14) | 0; x6 ^= (t << 13) | (t >>> 19); t = (x6 + x2) | 0; x10 ^= (t << 18) | (t >>> 14);
    t = (x15 + x11) | 0; x3 ^= (t << 7) | (t >>> 25); t = (x3 + x15) | 0; x7 ^= (t << 9) | (t >>> 23);
    t = (x7 + x3) | 0; x11 ^= (t << 13) | (t >>> 19); t = (x11 + x7) | 0; x15 ^= (t << 18) | (t >>> 14);
    t = (x0 + x3) | 0; x1 ^= (t << 7) | (t >>> 25); t = (x1 + x0) | 0; x2 ^= (t << 9) | (t >>> 23);
    t = (x2 + x1) | 0; x3 ^= (t << 13) | (t >>> 19); t = (x3 + x2) | 0; x0 ^= (t << 18) | (t >>> 14);
    t = (x5 + x4) | 0; x6 ^= (t << 7) | (t >>> 25); t = (x6 + x5) | 0; x7 ^= (t << 9) | (t >>> 23);
    t = (x7 + x6) | 0; x4 ^= (t << 13) | (t >>> 19); t = (x4 + x7) | 0; x5 ^= (t << 18) | (t >>> 14);
    t = (x10 + x9) | 0; x11 ^= (t << 7) | (t >>> 25); t = (x11 + x10) | 0; x8 ^= (t << 9) | (t >>> 23);
    t = (x8 + x11) | 0; x9 ^= (t << 13) | (t >>> 19); t = (x9 + x8) | 0; x10 ^= (t << 18) | (t >>> 14);
    t = (x15 + x14) | 0; x12 ^= (t << 7) | (t >>> 25); t = (x12 + x15) | 0; x13 ^= (t << 9) | (t >>> 23);
    t = (x13 + x12) | 0; x14 ^= (t << 13) | (t >>> 19); t = (x14 + x13) | 0; x15 ^= (t << 18) | (t >>> 14);
  }
  B[0] += x0; B[1] += x1; B[2] += x2; B[3] += x3; B[4] += x4; B[5] += x5; B[6] += x6; B[7] += x7;
  B[8] += x8; B[9] += x9; B[10] += x10; B[11] += x11; B[12] += x12; B[13] += x13; B[14] += x14; B[15] += x15;
}

// XY 的前 w 个字是当前块 B,后 w 个字是暂存区 Y
function blockMix(XY, r, x) {
  const w = 32 * r;
  x.set(XY.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) x[k] ^= XY[i * 16 + k];
    salsa20_8(x);
    XY.set(x, w + ((i & 1) ? r + (i >> 1) : i >> 1) * 16); // 偶数块在前、奇数块在后
  }
  XY.copyWithin(0, w, 2 * w);
}

async function pbkdf2Sha256(pass, salt, len) {
  const k = await crypto.subtle.importKey("raw", pass, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1 }, k, len * 8));
}

/** scrypt(RFC 7914)。n=2^18、r=8 时需要约 256 MB 内存,桌面浏览器需几秒到十几秒。 */
export async function scrypt(pass, salt, N, r, p, dkLen) {
  const w = 32 * r;
  const B = await pbkdf2Sha256(pass, salt, p * 128 * r);
  const dv = new DataView(B.buffer);
  const XY = new Uint32Array(2 * w);
  const V = new Uint32Array(w * N);
  const x = new Uint32Array(16);
  for (let k = 0; k < p; k++) {
    const off = k * 128 * r;
    for (let i = 0; i < w; i++) XY[i] = dv.getUint32(off + i * 4, true);
    for (let i = 0; i < N; i++) { V.set(XY.subarray(0, w), i * w); blockMix(XY, r, x); }
    for (let i = 0; i < N; i++) {
      const vo = (XY[(2 * r - 1) * 16] & (N - 1)) * w;
      for (let t = 0; t < w; t++) XY[t] ^= V[vo + t];
      blockMix(XY, r, x);
    }
    for (let i = 0; i < w; i++) dv.setUint32(off + i * 4, XY[i], true);
  }
  return pbkdf2Sha256(pass, B, dkLen);
}


// ---- 解开密钥文件 ---------------------------------------------------------------

/**
 * 解开密钥文件,返回 32 字节种子。
 * @param {string|object} jsonText 密钥文件内容(字符串或已解析的对象)
 * @param {string} password
 * @returns {Promise<Uint8Array>}
 */
export async function decryptZhixingKeystore(jsonText, password) {
  let ks;
  try {
    ks = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch (_) {
    throw new Error('这不是一个密钥文件(无法解析 JSON)');
  }
  const c = ks && (ks.crypto || ks.Crypto);
  if (!c || Number(ks.version) !== 3) throw new Error('不支持的密钥文件:只支持 version 3');
  if (c.kdf !== 'scrypt' || c.cipher !== 'aes-128-ctr') {
    throw new Error('不支持的密钥文件:只支持 scrypt + aes-128-ctr');
  }
  const { n, r, p, dklen, salt } = c.kdfparams || {};
  if (dklen !== 32 || !Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0 || n > 2 ** 20
    || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4
    || 128 * r * n > 512 * 2 ** 20) {
    throw new Error('密钥文件的 scrypt 参数超出支持范围');
  }
  const iv = hexToBytes(c.cipherparams?.iv);
  const ct = hexToBytes(c.ciphertext);
  const mac = hexToBytes(c.mac);
  if (iv.length !== 16 || ct.length !== 32 || mac.length !== 32) throw new Error('密钥文件内容不完整');
  const dk = await scrypt(enc.encode(password), hexToBytes(salt), n, r, p, 32);
  const want = keccak256(concat(dk.slice(16, 32), ct));
  if (bytesToHex(want) !== bytesToHex(mac)) throw new Error('密钥文件的口令不对');
  const aes = await crypto.subtle.importKey('raw', dk.slice(0, 16), 'AES-CTR', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: iv, length: 128 }, aes, ct));
}

/**
 * 解析 `node keygen` 写的**明文**种子文件:正文是 64 位十六进制种子,上面可能有
 * `# mnemonic:` / `# passphrase:` / `# pubkey:` 的注释行。
 * @param {string} text
 * @returns {{ seedHex: string, mnemonic?: string, passphrase?: string, pubkey?: string }}
 */
export function parseZhixingSeedFile(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = {};
  let seedLine = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) {
      const m = /^#\s*(mnemonic|passphrase|pubkey)\s*:\s*(.*)$/.exec(t);
      if (m) out[m[1]] = m[2].trim();
      continue;
    }
    if (!seedLine) seedLine = t;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(seedLine)) {
    throw new Error('这不是知行图的种子文件:应为 64 位十六进制(可用 node keygen 生成)');
  }
  if (out.passphrase === '<empty>') out.passphrase = '';
  return { seedHex: seedLine.toLowerCase(), ...out };
}


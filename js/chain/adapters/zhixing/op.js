// @ts-check
/**
 * 知行图(ZhixingGraph)知识操作:编码、可读摘要、签名。
 *
 * 知行图是一条记录"知识单元、版本、引用与核验"的链(https://github.com/yeying-community/blockchain)。
 * 它没有代币余额,也没有转账;钱包在这里只做一件事:**替成员签署知识操作**(写作、修订、核验、邀请)。
 *
 * 为什么由钱包来编码,而不是让网页直接递来待签字节:
 *   网页只给出"意图"(动作 + 参数),钱包自己编码、自己给用户看可读摘要、自己签。
 *   这样用户在审批弹窗里看到的,就是实际被签的内容——网页没法塞进别的字节。
 *
 * 字节格式与节点逐字节一致(node/src/codec.rs enc_knowledge_op):
 *   op   = actor:u64 ‖ action ‖ nonce:u64                     (大端)
 *   sig  = ed25519( "zhixing-knowledge-op-v1" ‖ op )
 *   提交 = op ‖ sig                                           (直接 POST /rpc/knowledge)
 * 一致性由 tests/zhixing-op.test.mjs 对照知行图参考签名器(tools/explorer/reference/signer.js,其本身已逐字节对照 Rust 节点)的输出检验。
 */

import nacl from '../../../../lib/nacl.js';

const enc = new TextEncoder();
export const ZHIXING_SIGN_DOMAIN = 'zhixing-knowledge-op-v1';

const VERDICT = Object.freeze({ pass: 0, 'needs-revision': 1 });
const LAYER = Object.freeze({ foundation: 0, explanation: 1, scenario: 2, application: 3 });
const CITE_KIND = Object.freeze({ basis: 0, 'see-also': 1, supersedes: 2 });
const MAX_CITES = 32;
const MAX_BODIES = 16;
const MAX_LANG_LEN = 16;
const MAX_MODEL_ID_LEN = 64;
const U64_MAX = (1n << 64n) - 1n;

// ---- 字节工具 -----------------------------------------------------------------

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

const u8 = (v) => Uint8Array.of(v);
function u32(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('ZHIXING_BAD_U32');
  const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b;
}
function u64(v) {
  let n;
  try { n = BigInt(v); } catch (_) { throw new Error('ZHIXING_BAD_U64'); }
  if (n < 0n || n > U64_MAX) throw new Error('ZHIXING_BAD_U64');
  const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n); return b;
}

function hash32(hex, what) {
  const b = hexToBytes(hex);
  if (b.length !== 32) throw new Error(`ZHIXING_BAD_HASH: ${what} 应为 32 字节`);
  return b;
}

// ---- 编码 ---------------------------------------------------------------------

function encodeVersionPayload(p) {
  const bodies = p.bodies || [];
  if (!Array.isArray(bodies) || bodies.length === 0) throw new Error('ZHIXING_BAD_ACTION: 至少需要一个正文');
  if (bodies.length > MAX_BODIES) throw new Error(`ZHIXING_BAD_ACTION: 正文最多 ${MAX_BODIES} 个`);
  const parts = [u64(bodies.length)];
  for (const b of bodies) {
    const lang = enc.encode(String(b.lang || ''));
    if (lang.length === 0 || lang.length > MAX_LANG_LEN) throw new Error(`ZHIXING_BAD_ACTION: 语言标签需 1–${MAX_LANG_LEN} 字节`);
    parts.push(u32(lang.length), lang, hash32(b.hash, '正文哈希'));
  }
  const src = p.source || { type: 'human' };
  if (src.type === 'human') {
    parts.push(u8(0));
  } else if (src.type === 'model' || src.type === 'model-verified') {
    const id = enc.encode(String(src.id || ''));
    if (id.length === 0 || id.length > MAX_MODEL_ID_LEN) throw new Error(`ZHIXING_BAD_ACTION: 模型标识需 1–${MAX_MODEL_ID_LEN} 字节`);
    parts.push(u8(src.type === 'model' ? 1 : 2), u32(id.length), id);
  } else {
    throw new Error('ZHIXING_BAD_ACTION: 来源只能是 human / model / model-verified');
  }
  const cites = p.cites || [];
  if (cites.length > MAX_CITES) throw new Error(`ZHIXING_BAD_ACTION: 引用最多 ${MAX_CITES} 条`);
  parts.push(u64(cites.length));
  for (const c of cites) {
    if (!(c.kind in CITE_KIND)) throw new Error('ZHIXING_BAD_ACTION: 引用类型只能是 basis / see-also / supersedes');
    parts.push(u64(c.unit), u32(c.version), u8(CITE_KIND[c.kind]));
  }
  return concat(...parts);
}

function encodeAction(a) {
  switch (a && a.type) {
    case 'create':
      if (!(a.layer in LAYER)) throw new Error('ZHIXING_BAD_ACTION: 层级只能是 foundation / explanation / scenario / application');
      return concat(u8(0), u8(LAYER[a.layer]), u32(a.domain), encodeVersionPayload(a));
    case 'publish':
      return concat(u8(1), u64(a.unit), encodeVersionPayload(a));
    case 'verify': {
      if (!(a.verdict in VERDICT)) throw new Error('ZHIXING_BAD_ACTION: verdict 只能是 pass / needs-revision');
      const note = a.noteHash ? hash32(a.noteHash, 'noteHash') : new Uint8Array(32);
      return concat(u8(2), u64(a.unit), u32(a.version), u8(VERDICT[a.verdict]), note);
    }
    case 'invite':
      return concat(u8(3), hash32(a.pubkey, '被邀请者公钥'));
    default:
      throw new Error('ZHIXING_BAD_ACTION: 不认识的操作 ' + (a && a.type));
  }
}

/** op 编码(不含签名)。 */
export function encodeKnowledgeOp(actor, action, nonce) {
  return concat(u64(actor), encodeAction(action), u64(nonce));
}

// ---- 可读摘要(审批弹窗用)------------------------------------------------------

const LAYER_ZH = { foundation: '基础', explanation: '解释', scenario: '场景', application: '应用' };
const KIND_ZH = { basis: '依据', 'see-also': '参见', supersedes: '取代' };
const SOURCE_ZH = (s) => {
  const src = s || { type: 'human' };
  if (src.type === 'human') return '人工撰写';
  if (src.type === 'model') return `模型生成(${src.id})`;
  return `模型生成、人工核验过(${src.id})`;
};

function describeVersion(a) {
  const lines = [`来源:${SOURCE_ZH(a.source)}`];
  for (const b of a.bodies || []) lines.push(`正文(${b.lang}):sha256 ${String(b.hash).replace(/^0x/i, '').slice(0, 16)}…`);
  const cites = a.cites || [];
  if (cites.length) {
    lines.push('引用:' + cites.map((c) => `${KIND_ZH[c.kind] || c.kind} #${c.unit} v${c.version}`).join('、'));
  } else {
    lines.push('引用:无');
  }
  return lines;
}

/**
 * 给用户看的摘要:标题一行 + 若干明细行。编码前先调用 encodeKnowledgeOp 校验,
 * 所以能走到这里的 action 一定是合法、可编码的。
 * @returns {{ title: string, lines: string[], risk?: string }}
 */
export function describeKnowledgeOp(actor, action, nonce) {
  encodeKnowledgeOp(actor, action, nonce); // 先校验
  const who = `以账户 #${actor} 的身份(序号 ${nonce})`;
  switch (action.type) {
    case 'verify': {
      const verdict = action.verdict === 'pass' ? '通过' : '需修改';
      return {
        title: `核验单元 #${action.unit} 的 v${action.version}:${verdict}`,
        lines: [who, '这条核验记录会永久保存在链上,并影响该单元的可信度。'],
      };
    }
    case 'create':
      return {
        title: `创建新知识单元(${LAYER_ZH[action.layer]}层,领域 ${action.domain})`,
        lines: [who, ...describeVersion(action), '内容将以 CC BY 4.0 许可公开,并永久记录在链上。'],
      };
    case 'publish':
      return {
        title: `为单元 #${action.unit} 发布新版本`,
        lines: [who, ...describeVersion(action), '你会被记录为这个版本的发布者;新版本需要重新核验。'],
      };
    case 'invite':
      return {
        title: '邀请新成员加入知行图',
        lines: [who, `被邀请者公钥:${String(action.pubkey).replace(/^0x/i, '')}`],
        risk: '你将成为这位成员的担保人:被担保人作恶被查实时,担保人会连带受罚。',
      };
    default:
      throw new Error('ZHIXING_BAD_ACTION');
  }
}

// ---- 签名 ---------------------------------------------------------------------

/**
 * 签署一条知识操作,返回可直接提交给节点的完整编码(op ‖ 64 字节签名)。
 * @param {{ secretKey: Uint8Array }} keypair nacl KeyPair
 */
export function signKnowledgeOp(keypair, actor, action, nonce) {
  const body = encodeKnowledgeOp(actor, action, nonce);
  const sig = nacl.sign.detached(concat(enc.encode(ZHIXING_SIGN_DOMAIN), body), keypair.secretKey);
  return concat(body, sig);
}

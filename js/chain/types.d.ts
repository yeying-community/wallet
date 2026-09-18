/**
 * 链适配层类型定义
 *
 * 对齐 docs/钱包架构/链适配层设计.md §5。阶段 0 仅落地 EVM 适配器与
 * local-keyring / mpc-cggmp24 两个 signer；未实现的能力在 evm 适配器中挂
 * NOT_IMPLEMENTED，留待阶段 2+。
 *
 * 以 TS 声明书写（供 // @ts-check 的 JS 经 import('./types.d.ts').X 引用）。
 */

export type Curve = 'secp256k1' | 'ed25519';

/** 链无关的用户意图。 */
export interface Intent {
  type:
    | 'native-transfer'
    | 'token-transfer'
    | 'contract-call'
    | 'sign-message'
    | 'sign-typed-data'
    | 'sign-transaction';
  from?: string;
  to?: string;
  /** 最小单位字符串（wei/sun/lamport/sat），不做 18 位假设 */
  amount?: string;
  asset?: Record<string, unknown>;
  /** EVM calldata / 其它链等价物 */
  data?: string;
  /** sign-transaction：原始交易对象 */
  transaction?: Record<string, unknown>;
  /** sign-message：原文 */
  message?: string;
  /** sign-typed-data */
  domain?: Record<string, unknown>;
  types?: Record<string, unknown>;
  value?: Record<string, unknown>;
  /** dApp 透传的原始请求 */
  raw?: unknown;
}

/** 待签摘要/原文。ECDSA 走 digest（已哈希），EdDSA 走 message（签原文）。 */
export interface SignPayload {
  kind: 'digest' | 'message';
  /** hex 字符串（0x...） */
  bytes: string;
  /** digest 已用何算法；message 为 null */
  hashAlg: 'keccak256' | 'sha256' | null;
}

/** 适配器产出的待签交易，是 adapter 与 signer 之间唯一的交换格式。 */
export interface UnsignedTx {
  curve: Curve;
  /** UTXO 每输入一个；账户模型通常一个 */
  payloads: SignPayload[];
  /** adapter 内部重组 rawTx 所需的上下文 */
  serializeState: unknown;
  /** secp256k1 是否需要 recid */
  needsRecoveryId: boolean;
}

/** 单个签名分量。 */
export interface SignaturePart {
  /** secp256k1: r‖s（0x + 128 hex） */
  rs?: string;
  r?: string;
  s?: string;
  /** secp256k1 recovery id，0/1 */
  recid?: number;
  /** ed25519: 完整 64B 签名（0x...） */
  signature?: string;
}

/** 签名结果，parts 与 UnsignedTx.payloads 一一对应。 */
export interface SignatureResult {
  parts: SignaturePart[];
}

/** 链上下文（内部）。 */
export interface ChainCtx {
  /** eip155:1 */
  chainKey: string;
  /** 0x1（派生，供 ethers/序列化/广播） */
  chainIdHex?: string;
  rpcUrl?: string;
}

/** 签名上下文（内部）。 */
export interface SignCtx {
  accountId: string;
}

/** 签名引擎（按密钥来源区分：本地私钥 / MPC）。 */
export interface Signer {
  supportedCurves: Set<Curve>;
  sign(u: UnsignedTx, ctx: SignCtx): Promise<SignatureResult>;
}

/**
 * 链适配器。阶段 0 EVM 实现 buildUnsigned/assembleSigned/broadcast；
 * deriveAddress/estimateFee/getTxStatus/summarize 与余额留待后续阶段。
 */
export interface ChainAdapter {
  namespace: 'eip155' | 'tron' | 'solana' | 'bip122';
  family: 'evm' | 'tron' | 'solana' | 'utxo';
  curve: Curve;
  coinType: number;
  chainKey(net: { chainId?: string | number }): string;
  isValidAddress(addr: string): boolean;
  displayAddress(addr: string): string;
  buildUnsigned(intent: Intent, ctx: ChainCtx): Promise<UnsignedTx>;
  assembleSigned(u: UnsignedTx, sig: SignatureResult): string;
  broadcast(rawTx: string, ctx: ChainCtx): Promise<string>;
  getNativeBalance?(addr: string, ctx: ChainCtx): Promise<unknown>;
  getTokenBalance?(addr: string, token: Record<string, unknown>, ctx: ChainCtx): Promise<unknown>;
}

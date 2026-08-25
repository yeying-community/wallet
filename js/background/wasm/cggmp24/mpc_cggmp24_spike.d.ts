/* tslint:disable */
/* eslint-disable */

export class Cggmp24AuxInfoSession {
    free(): void;
    [Symbol.dispose](): void;
    advanceJson(max_steps: number): string;
    drainOutgoingJson(): string;
    constructor(session_id: string, sender_index: number, party_count: number);
    static newWithSeed(session_id: string, sender_index: number, party_count: number, seed_hex: string): Cggmp24AuxInfoSession;
    receiveWireMessageJson(json: string): string;
    resultJson(): string;
    status(): string;
}

export class Cggmp24SigningSession {
    free(): void;
    [Symbol.dispose](): void;
    advanceJson(max_steps: number): string;
    drainOutgoingJson(): string;
    constructor(session_id: string, request_id: string, sender_index: number, parties_json: string, key_share_json: string, message_hex: string);
    static newWithSeed(session_id: string, request_id: string, sender_index: number, parties_json: string, key_share_json: string, message_hex: string, seed_hex: string): Cggmp24SigningSession;
    receiveWireMessageJson(json: string): string;
    resultJson(): string;
    status(): string;
}

export class Cggmp24ThresholdKeygenSession {
    free(): void;
    [Symbol.dispose](): void;
    advanceJson(max_steps: number): string;
    drainOutgoingJson(): string;
    constructor(session_id: string, sender_index: number, party_count: number, threshold: number);
    static newWithSeed(session_id: string, sender_index: number, party_count: number, threshold: number, seed_hex: string): Cggmp24ThresholdKeygenSession;
    receiveWireMessageJson(json: string): string;
    resultJson(): string;
    status(): string;
}

export function cggmp24EngineMetadataJson(): string;

export function combineKeyShareJson(core_json: string, aux_info_json: string): string;

export function coreKeySharePublicMaterialJson(json: string): string;

export function devTrustedAuxInfoJson(session_id: string, party_count: number, participant_index: number): string;

export function normalizeAuxInfoPayloadJson(json: string): string;

export function normalizeSigningPayloadJson(json: string): string;

export function normalizeThresholdKeygenPayloadJson(json: string): string;

export function normalizeWireMessageJson(json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_cggmp24auxinfosession_free: (a: number, b: number) => void;
    readonly __wbg_cggmp24signingsession_free: (a: number, b: number) => void;
    readonly __wbg_cggmp24thresholdkeygensession_free: (a: number, b: number) => void;
    readonly cggmp24EngineMetadataJson: () => [number, number, number, number];
    readonly cggmp24auxinfosession_advanceJson: (a: number, b: number) => [number, number, number, number];
    readonly cggmp24auxinfosession_drainOutgoingJson: (a: number) => [number, number, number, number];
    readonly cggmp24auxinfosession_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly cggmp24auxinfosession_newWithSeed: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly cggmp24auxinfosession_receiveWireMessageJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly cggmp24auxinfosession_resultJson: (a: number) => [number, number, number, number];
    readonly cggmp24auxinfosession_status: (a: number) => [number, number];
    readonly cggmp24signingsession_advanceJson: (a: number, b: number) => [number, number, number, number];
    readonly cggmp24signingsession_drainOutgoingJson: (a: number) => [number, number, number, number];
    readonly cggmp24signingsession_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly cggmp24signingsession_newWithSeed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly cggmp24signingsession_receiveWireMessageJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly cggmp24signingsession_resultJson: (a: number) => [number, number, number, number];
    readonly cggmp24signingsession_status: (a: number) => [number, number];
    readonly cggmp24thresholdkeygensession_advanceJson: (a: number, b: number) => [number, number, number, number];
    readonly cggmp24thresholdkeygensession_drainOutgoingJson: (a: number) => [number, number, number, number];
    readonly cggmp24thresholdkeygensession_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly cggmp24thresholdkeygensession_newWithSeed: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly cggmp24thresholdkeygensession_receiveWireMessageJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly cggmp24thresholdkeygensession_resultJson: (a: number) => [number, number, number, number];
    readonly cggmp24thresholdkeygensession_status: (a: number) => [number, number];
    readonly combineKeyShareJson: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly coreKeySharePublicMaterialJson: (a: number, b: number) => [number, number, number, number];
    readonly devTrustedAuxInfoJson: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly normalizeAuxInfoPayloadJson: (a: number, b: number) => [number, number, number, number];
    readonly normalizeSigningPayloadJson: (a: number, b: number) => [number, number, number, number];
    readonly normalizeThresholdKeygenPayloadJson: (a: number, b: number) => [number, number, number, number];
    readonly normalizeWireMessageJson: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

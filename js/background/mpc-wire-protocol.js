export const MPC_WIRE_ENGINE = 'cggmp24';
export const MPC_WIRE_PROTOCOL_VERSION = 1;

const VALID_PROTOCOLS = new Set(['keygen', 'aux-info', 'sign']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMpcProtocol(protocol) {
  const normalized = String(protocol || '').trim();
  if (!VALID_PROTOCOLS.has(normalized)) {
    throw new Error('INVALID_MPC_WIRE_PROTOCOL');
  }
  return normalized;
}

export function normalizeMpcAudience(audience) {
  if (audience === 'all-parties') {
    return 'all-parties';
  }
  if (!isObject(audience)) {
    throw new Error('INVALID_MPC_WIRE_AUDIENCE');
  }
  const oneParty = audience['one-party'] || audience.oneParty;
  if (!isObject(oneParty)) {
    throw new Error('INVALID_MPC_WIRE_AUDIENCE');
  }
  const recipientIndex = Number(oneParty.recipient_index ?? oneParty.recipientIndex);
  if (!Number.isInteger(recipientIndex) || recipientIndex < 0) {
    throw new Error('INVALID_MPC_WIRE_AUDIENCE');
  }
  return { 'one-party': { recipient_index: recipientIndex } };
}

export function createMpcWireMessage({
  sessionId,
  protocol,
  senderIndex,
  audience,
  payload,
  sequence = 0
} = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    throw new Error('MPC_SESSION_ID_REQUIRED');
  }
  const normalizedSenderIndex = Number(senderIndex);
  if (!Number.isInteger(normalizedSenderIndex) || normalizedSenderIndex < 0) {
    throw new Error('INVALID_MPC_PARTICIPANT_INDEX');
  }
  if (payload === undefined || payload === null) {
    throw new Error('MPC_WIRE_PAYLOAD_REQUIRED');
  }
  return {
    protocol_version: MPC_WIRE_PROTOCOL_VERSION,
    engine: MPC_WIRE_ENGINE,
    session_id: normalizedSessionId,
    protocol: normalizeMpcProtocol(protocol),
    sequence: Number.isFinite(Number(sequence)) ? Number(sequence) : 0,
    sender_index: normalizedSenderIndex,
    audience: normalizeMpcAudience(audience),
    payload
  };
}

export function inferMpcWireRound(payload) {
  if (!isObject(payload)) return 0;
  const explicitRound = Number(payload.round);
  if (Number.isFinite(explicitRound)) return explicitRound;
  const key = Object.keys(payload)[0] || '';
  const normalized = key.toLowerCase();
  if (normalized.includes('round1')) return 1;
  if (normalized.includes('round2')) return 2;
  if (normalized.includes('round3')) return 3;
  if (normalized.includes('round4')) return 4;
  return 0;
}

export function parseMpcWireMessage(message) {
  const envelope = isObject(message?.envelope) ? message.envelope : message;
  if (!isObject(envelope)) {
    throw new Error('INVALID_MPC_WIRE_MESSAGE');
  }
  const version = Number(envelope.protocol_version ?? envelope.protocolVersion);
  if (version !== MPC_WIRE_PROTOCOL_VERSION) {
    throw new Error('INVALID_MPC_WIRE_VERSION');
  }
  if (String(envelope.engine || '').trim() !== MPC_WIRE_ENGINE) {
    throw new Error('INVALID_MPC_WIRE_ENGINE');
  }
  const sessionId = String(envelope.session_id ?? envelope.sessionId ?? '').trim();
  const senderIndex = Number(envelope.sender_index ?? envelope.senderIndex);
  const sequence = Number(envelope.sequence ?? message?.seq ?? 0);
  return {
    ...envelope,
    protocol_version: MPC_WIRE_PROTOCOL_VERSION,
    engine: MPC_WIRE_ENGINE,
    session_id: sessionId,
    protocol: normalizeMpcProtocol(envelope.protocol),
    sequence: Number.isFinite(sequence) ? sequence : 0,
    sender_index: Number.isInteger(senderIndex) ? senderIndex : -1,
    audience: normalizeMpcAudience(envelope.audience),
    payload: envelope.payload
  };
}

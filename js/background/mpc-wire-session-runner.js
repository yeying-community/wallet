function getMessageProtocol(message) {
  return String(message?.envelope?.protocol || message?.type || '').trim();
}

function getMessageRequestId(message) {
  return String(message?.envelope?.request_id ?? '').trim();
}

function getMessageSenderIndex(message) {
  const senderIndex = Number(message?.envelope?.sender_index ?? message?.sender);
  return Number.isInteger(senderIndex) ? senderIndex : null;
}

function summarizeWireMessage(message) {
  return {
    id: message?.id || '',
    seq: Number(message?.seq ?? message?.envelope?.sequence ?? 0),
    protocol: getMessageProtocol(message),
    requestId: getMessageRequestId(message),
    senderIndex: getMessageSenderIndex(message)
  };
}

function getMessagePayloadRound(message) {
  const payload = message?.envelope?.payload ?? message?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return Object.keys(payload)[0] || '';
}

function getAuxInfoDedupKey(message) {
  const senderIndex = getMessageSenderIndex(message);
  const round = getMessagePayloadRound(message);
  if (senderIndex === null || !round) return '';
  return `${senderIndex}:${round}`;
}

function isSkippableUnexpectedMessage(error) {
  const message = String(error?.message || error || '').trim();
  return message.includes('MPC_AUX_INFO_UNEXPECTED_MESSAGE');
}

export class MpcWireSessionRunner {
  constructor({ adapter, transport, sessionId, recipientIndex, protocol = '', requestId = '', afterSequence = 0, limit = 50 } = {}) {
    if (!adapter) {
      throw new Error('MPC_TSS_ADAPTER_REQUIRED');
    }
    if (!transport || typeof transport.fetchWireMessages !== 'function') {
      throw new Error('MPC_WIRE_TRANSPORT_REQUIRED');
    }
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('MPC_SESSION_ID_REQUIRED');
    }
    const normalizedRecipientIndex = Number(recipientIndex);
    if (!Number.isInteger(normalizedRecipientIndex) || normalizedRecipientIndex < 0) {
      throw new Error('INVALID_MPC_PARTICIPANT_INDEX');
    }
    this.adapter = adapter;
    this.transport = transport;
    this.sessionId = normalizedSessionId;
    this.recipientIndex = normalizedRecipientIndex;
    this.protocol = String(protocol || '').trim();
    this.requestId = String(requestId || '').trim();
    this.afterSequence = Number.isFinite(Number(afterSequence)) ? Number(afterSequence) : 0;
    this.limit = Math.max(1, Math.min(Number(limit) || 50, 200));
  }

  async pollOnce(options = {}) {
    const response = await this.transport.fetchWireMessages(this.sessionId, {
      after: this.afterSequence,
      recipientIndex: this.recipientIndex,
      limit: options.limit || this.limit,
      password: options.password
    });
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    const latestAuxInfoByRound = new Map();
    if (this.protocol === 'aux-info') {
      for (const message of messages) {
        const key = getAuxInfoDedupKey(message);
        if (!key) continue;
        const seq = Number(message?.seq ?? message?.envelope?.sequence ?? 0);
        const existing = latestAuxInfoByRound.get(key);
        const existingSeq = Number(existing?.seq ?? existing?.envelope?.sequence ?? 0);
        if (!existing || seq >= existingSeq) {
          latestAuxInfoByRound.set(key, message);
        }
      }
    }
    const handledMessages = [];
    const skippedMessages = [];
    const outputs = [];
    for (const message of messages) {
      const seq = Number(message?.seq ?? message?.envelope?.sequence ?? 0);
      if (Number.isFinite(seq)) {
        this.afterSequence = Math.max(this.afterSequence, seq);
      }
      const messageProtocol = getMessageProtocol(message);
      if (this.protocol && messageProtocol && messageProtocol !== this.protocol) {
        skippedMessages.push(message);
        continue;
      }
      const messageRequestId = getMessageRequestId(message);
      if (this.requestId && (this.protocol === 'aux-info' || messageRequestId) && messageRequestId !== this.requestId) {
        skippedMessages.push(message);
        continue;
      }
      if (getMessageSenderIndex(message) === this.recipientIndex) {
        skippedMessages.push(message);
        continue;
      }
      const dedupKey = this.protocol === 'aux-info' ? getAuxInfoDedupKey(message) : '';
      if (dedupKey && latestAuxInfoByRound.get(dedupKey) !== message) {
        skippedMessages.push({
          ...message,
          skipReason: 'MPC_AUX_INFO_STALE_DUPLICATE_MESSAGE'
        });
        continue;
      }
      try {
        outputs.push(await this.adapter.receiveMessage({
          sessionId: this.sessionId,
          message,
          maxSteps: options.advanceMaxSteps,
          password: options.password
        }));
      } catch (error) {
        if (!isSkippableUnexpectedMessage(error)) {
          error.wireMessage = summarizeWireMessage(message);
          throw error;
        }
        skippedMessages.push({
          ...message,
          skipReason: error?.message || String(error || '')
        });
        continue;
      }
      handledMessages.push(message);
    }
    if (!handledMessages.length && typeof this.adapter.advance === 'function') {
      try {
        const advanced = await this.adapter.advance({
          sessionId: this.sessionId,
          maxSteps: options.advanceMaxSteps,
          password: options.password
        });
        if (Array.isArray(advanced?.messages) && advanced.messages.length > 0) {
          outputs.push(advanced);
        }
      } catch (error) {
        if (String(error?.message || error || '') !== 'MPC_TSS_SESSION_NOT_STARTED') {
          throw error;
        }
      }
    }
    const nextSequence = Number(response?.nextSequence);
    if (Number.isFinite(nextSequence)) {
      this.afterSequence = Math.max(this.afterSequence, nextSequence);
    }
    return {
      messages: handledMessages,
      skippedMessages,
      outputs,
      nextSequence: this.afterSequence
    };
  }
}

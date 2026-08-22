export class MpcWireSessionRunner {
  constructor({ adapter, transport, sessionId, recipientIndex, afterSequence = 0, limit = 50 } = {}) {
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
    const outputs = [];
    for (const message of messages) {
      outputs.push(await this.adapter.receiveMessage({
        sessionId: this.sessionId,
        message
      }));
      const seq = Number(message?.seq ?? message?.envelope?.sequence ?? 0);
      if (Number.isFinite(seq)) {
        this.afterSequence = Math.max(this.afterSequence, seq);
      }
    }
    const nextSequence = Number(response?.nextSequence);
    if (Number.isFinite(nextSequence)) {
      this.afterSequence = Math.max(this.afterSequence, nextSequence);
    }
    return {
      messages,
      outputs,
      nextSequence: this.afterSequence
    };
  }
}

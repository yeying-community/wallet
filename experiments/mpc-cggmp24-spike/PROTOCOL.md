# cggmp24 Wallet/Node Protocol Boundary

This spike keeps production wallet code untouched. The goal is to define the
boundary that lets a browser wallet run a real `cggmp24` state machine while
node only stores, routes, and audits protocol messages.

## Responsibilities

Wallet:

- Owns the `cggmp24` WASM engine instance.
- Owns encrypted key shares and auxiliary data.
- Creates one local state machine per MPC session and participant.
- Calls `proceed()` until the engine needs to send or receive a message.
- Serializes `cggmp24` messages into the stable wire envelope below.
- Verifies the final threshold ECDSA signature against the shared public key.

Node:

- Creates MPC sessions and assigns stable participant indices.
- Stores and returns protocol messages in append-only sequence order.
- Authenticates every posted message with the participant wallet identity.
- Encrypts or accepts already encrypted p2p message bodies.
- Never receives plaintext key shares, private keys, or reconstructed secrets.
- Never signs on behalf of a participant.

## State Machine Loop

`round-based` exposes this shape:

```text
loop:
  result = state.proceed()

  SendMsg(outgoing):
    wallet serializes outgoing into MpcWireMessage
    wallet posts it to node
    continue

  NeedsOneMoreMessage:
    wallet waits for/pulls the next message addressed to this participant
    wallet converts it into round_based::Incoming
    state.received_msg(incoming)
    continue

  Yielded:
    wallet schedules the next local tick
    continue

  Output(signature_or_share):
    wallet persists the result locally and reports completion metadata to node
    stop

  Error(error):
    wallet reports explicit MPC failure
    stop
```

The wallet must not silently fall back to HD/imported-wallet signing if this
loop fails. Production should surface `MPC_SIGNER_NOT_CONFIGURED` or the exact
TSS failure.

## Wire Envelope

Only one top-level message contract should be used:

```json
{
  "protocol_version": 1,
  "engine": "cggmp24",
  "session_id": "uuid",
  "protocol": "sign",
  "sequence": 12,
  "sender_index": 0,
  "audience": {
    "one-party": {
      "recipient_index": 1
    }
  },
  "payload": {}
}
```

Fields:

- `protocol_version`: fixed integer, currently `1`.
- `engine`: fixed string, currently `cggmp24`.
- `session_id`: node MPC session ID.
- `protocol`: one of `keygen`, `aux-info`, `sign`.
- `sequence`: monotonically increasing per session, assigned by node.
- `sender_index`: stable participant index from keygen/session setup.
- `audience`: `all-parties` or `one-party`.
- `payload`: serde-encoded `cggmp24` protocol message.

For `round-based::Outgoing`:

- `MessageDestination::AllParties` maps to `audience = all-parties`.
- `MessageDestination::OneParty(i)` maps to `audience = one-party`.

For `round-based::Incoming`:

- `id` should be the node message sequence.
- `sender` should be `sender_index`.
- `msg_type` should match `audience`.
- `msg` should be the decoded `payload`.

## Required Node APIs

The current sign-request APIs are useful for the user-facing signing request,
but real TSS needs a lower-level message log:

- `POST /mpc/sessions/:sessionId/messages`
  - Accept one `MpcWireMessage`.
  - Validate session membership and sender index.
  - Assign or validate sequence.
  - Persist immutable message body and sender authentication metadata.

- `GET /mpc/sessions/:sessionId/messages?after=<sequence>&recipientIndex=<i>`
  - Return messages after a sequence.
  - Include broadcasts and p2p messages addressed to `recipientIndex`.
  - Exclude p2p messages for other participants.

- `POST /mpc/sessions/:sessionId/results`
  - Participant reports completion metadata only.
  - Signature/key-share material remains local unless it is explicitly public.

## Security Rules

- P2P payloads must be encrypted for the recipient before node persistence, or
  node must enforce transport/storage encryption with per-recipient access.
- Broadcast payloads must be authenticated. Reliable broadcast requirements
  should be handled explicitly if `enforce_reliable_broadcast(true)` is used.
- Session participant indices must be immutable once keygen starts.
- `ExecutionId` must include session ID, protocol type, and attempt number so
  retries cannot replay messages into a different protocol run.
- The engine must use `DataToSign::digest` for known-preimage signing unless a
  later design explicitly justifies prehashed signing.

## Open Engineering Work

- Measure `aux_info_gen` separately from keygen and signing.
- Decide whether aux info is pregenerated and cached per participant group.
- Build the full WASM state-machine wrapper. The current spike exports the
  initial ABI surface and JSON validation helpers:
  - `cggmp24EngineMetadataJson()`
  - `normalizeWireMessageJson(json)`
  - `normalizeSigningPayloadJson(json)`
  - `normalizeThresholdKeygenPayloadJson(json)`
  The production adapter expects the loaded JS engine to expose:
  - `startKeygen`
  - `startSign`
  - `receiveMessage`
  - `advance`
  - `getOutgoingMessages`
  - `getResult`
- Add node message-log persistence before wiring wallet UI.
- Add wallet encrypted local storage for `KeyShare` and `AuxInfo`.

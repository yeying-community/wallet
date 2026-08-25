use cggmp24::key_share::AnyKeyShare;
use cggmp24::supported_curves::Secp256k1;
use cggmp24::{aux_info_gen, signing, trusted_dealer, DataToSign, ExecutionId, KeyShare, Signature};
use rand::rngs::{OsRng, StdRng};
use rand::SeedableRng;
use round_based::state_machine::{ProceedResult, StateMachine};
use round_based::{Incoming, MessageDestination, MessageType};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sha3::{Digest, Keccak256};
use wasm_bindgen::prelude::*;

pub const ENGINE_ID: &str = "cggmp24";
pub const PROTOCOL_VERSION: u32 = 1;
pub const SECURITY_PROFILE: &str = "production-1536";
pub const SECURITY_PROFILE_PRODUCTION_SAFE: bool = true;
pub const RSA_PRIME_BITLEN: u32 = 1536;
pub const RSA_PUBKEY_BITLEN: u32 = 3071;

fn rng_from_seed_hex(seed_hex: &str) -> Result<StdRng, JsValue> {
    let trimmed = seed_hex.trim().strip_prefix("0x").unwrap_or(seed_hex.trim());
    let bytes = hex::decode(trimmed).map_err(to_js_error)?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| JsValue::from_str("MPC_CGGMP24_INVALID_SEED"))?;
    Ok(StdRng::from_seed(seed))
}

#[derive(Clone)]
pub struct SpikeSecurityLevel;

cggmp24::define_security_level!(SpikeSecurityLevel {
    kappa_bits: 256,
    rsa_prime_bitlen: RSA_PRIME_BITLEN,
    rsa_pubkey_bitlen: RSA_PUBKEY_BITLEN,
    epsilon: 256 * 2,
    ell: 256,
    ell_prime: 256 * 5,
    m: 128,
});

pub type SecpKeyShare = KeyShare<Secp256k1, SpikeSecurityLevel>;
pub type SecpCoreKeyShare = cggmp24_keygen::key_share::CoreKeyShare<Secp256k1>;
pub type SecpAuxInfo = cggmp24::key_share::AuxInfo<SpikeSecurityLevel>;
pub type SecpSignature = Signature<Secp256k1>;
pub type SecpSigningMessage = cggmp24::signing::msg::Msg<Secp256k1, Sha256>;
pub type SecpAuxInfoMessage = cggmp24::key_refresh::msg::Msg<Sha256, SpikeSecurityLevel>;
pub type SecpThresholdKeygenMessage =
    cggmp24_keygen::ThresholdMsg<Secp256k1, SpikeSecurityLevel, Sha256>;
type SecpThresholdKeygenState = Box<
    dyn StateMachine<
        Output = Result<SecpCoreKeyShare, cggmp24_keygen::KeygenError>,
        Msg = SecpThresholdKeygenMessage,
    >,
>;
type SecpAuxInfoState = Box<
    dyn StateMachine<
        Output = Result<cggmp24::key_share::AuxInfo<SpikeSecurityLevel>, cggmp24::key_refresh::KeyRefreshError>,
        Msg = SecpAuxInfoMessage,
    >,
>;
type SecpSigningState = Box<
    dyn StateMachine<
        Output = Result<SecpSignature, cggmp24::SigningError>,
        Msg = SecpSigningMessage,
    >,
>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MpcProtocolKind {
    Keygen,
    AuxInfo,
    Sign,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MpcMessageAudience {
    AllParties,
    OneParty { recipient_index: u16 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(bound = "M: Serialize + for<'de2> Deserialize<'de2>")]
pub struct MpcWireMessage<M> {
    pub protocol_version: u32,
    pub engine: String,
    pub session_id: String,
    pub protocol: MpcProtocolKind,
    pub sequence: u64,
    pub sender_index: u16,
    pub audience: MpcMessageAudience,
    pub payload: M,
}

impl<M> MpcWireMessage<M> {
    pub fn sign_broadcast(
        session_id: impl Into<String>,
        sequence: u64,
        sender_index: u16,
        payload: M,
    ) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            engine: ENGINE_ID.to_string(),
            session_id: session_id.into(),
            protocol: MpcProtocolKind::Sign,
            sequence,
            sender_index,
            audience: MpcMessageAudience::AllParties,
            payload,
        }
    }

    pub fn sign_p2p(
        session_id: impl Into<String>,
        sequence: u64,
        sender_index: u16,
        recipient_index: u16,
        payload: M,
    ) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            engine: ENGINE_ID.to_string(),
            session_id: session_id.into(),
            protocol: MpcProtocolKind::Sign,
            sequence,
            sender_index,
            audience: MpcMessageAudience::OneParty { recipient_index },
            payload,
        }
    }
}

pub fn signing_message_round(message: &SecpSigningMessage) -> &'static str {
    match message {
        SecpSigningMessage::Round1a(_) => "round1a",
        SecpSigningMessage::Round1b(_) => "round1b",
        SecpSigningMessage::Round2(_) => "round2",
        SecpSigningMessage::Round3(_) => "round3",
        SecpSigningMessage::Round4(_) => "round4",
        SecpSigningMessage::ReliabilityCheck(_) => "reliability-check",
    }
}

pub fn wire_message_round(message: &MpcWireMessage<SecpSigningMessage>) -> &'static str {
    signing_message_round(&message.payload)
}

pub fn trusted_dealer_2_of_2() -> Vec<SecpKeyShare> {
    trusted_dealer::builder::<Secp256k1, SpikeSecurityLevel>(2)
        .set_threshold(Some(2))
        .generate_shares(&mut OsRng)
        .expect("trusted dealer should generate 2-of-2 shares")
}

pub fn sign_message_2_of_2(shares: &[SecpKeyShare], message: &[u8]) -> SecpSignature {
    assert_eq!(shares.len(), 2);
    let data_to_sign = DataToSign::<Secp256k1>::digest::<Sha256>(message);
    let parties_indexes_at_keygen = [0u16, 1u16];
    let eid = ExecutionId::new(b"wallet-cggmp24-spike-signing");

    let result = round_based::sim::run_with_setup(
        shares.iter().enumerate().map(|(i, share)| (i as u16, share.clone())),
        |i, party, (keygen_i, share)| async move {
            signing(eid.clone(), i, &parties_indexes_at_keygen, &share)
                .set_digest::<Sha256>()
                .enforce_reliable_broadcast(false)
                .sign(&mut OsRng, party, &data_to_sign)
                .await
                .map(|signature| (keygen_i, signature))
        },
    )
    .expect("simulation should run")
    .expect_ok()
    .into_vec();

    assert_eq!(result.len(), 2);
    let signature = result[0].1;
    assert!(result.iter().all(|(_, item)| *item == signature));
    signature
}

pub fn verify_signature(share: &SecpKeyShare, message: &[u8], signature: &SecpSignature) -> bool {
    let data_to_sign = DataToSign::<Secp256k1>::digest::<Sha256>(message);
    signature
        .verify(&share.shared_public_key(), &data_to_sign)
        .is_ok()
}

pub fn serialize_signature_hex(signature: &SecpSignature) -> String {
    let mut out = vec![0u8; SecpSignature::serialized_len()];
    signature.write_to_slice(&mut out);
    hex::encode(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmEngineMetadata {
    pub engine: String,
    pub protocol_version: u32,
    pub curve: String,
    pub security_profile: String,
    pub production_safe: bool,
    pub rsa_prime_bitlen: u32,
    pub rsa_pubkey_bitlen: u32,
    pub protocols: Vec<MpcProtocolKind>,
    pub state_machine_api: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmOutgoingMessage {
    pub audience: MpcMessageAudience,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmAdvanceResult {
    pub status: String,
    pub outgoing: Vec<WasmOutgoingMessage>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreKeySharePublicMaterial {
    pub curve: String,
    pub compressed_public_key_hex: String,
    pub uncompressed_public_key_hex: String,
    pub ethereum_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedKeyShareJson {
    pub status: String,
    pub curve: String,
    pub key_share: serde_json::Value,
    pub compressed_public_key_hex: String,
    pub uncompressed_public_key_hex: String,
    pub ethereum_address: String,
}

fn to_js_error(error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn error_chain_to_string(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(error) = source {
        parts.push(error.to_string());
        source = error.source();
    }
    parts.join(": ")
}

fn core_key_share_public_material(
    share: &SecpCoreKeyShare,
) -> Result<CoreKeySharePublicMaterial, JsValue> {
    let compressed = share.shared_public_key.to_bytes(true);
    let uncompressed = share.shared_public_key.to_bytes(false);
    let uncompressed_bytes = uncompressed.as_ref();
    if uncompressed_bytes.len() != 65 || uncompressed_bytes.first() != Some(&0x04) {
        return Err(JsValue::from_str("MPC_CGGMP24_INVALID_PUBLIC_KEY_ENCODING"));
    }
    let hash = Keccak256::digest(&uncompressed_bytes[1..]);
    let address = &hash[hash.len() - 20..];
    Ok(CoreKeySharePublicMaterial {
        curve: "secp256k1".to_string(),
        compressed_public_key_hex: hex::encode(compressed.as_ref()),
        uncompressed_public_key_hex: hex::encode(uncompressed_bytes),
        ethereum_address: format!("0x{}", hex::encode(address)),
    })
}

fn key_share_public_material(share: &SecpKeyShare) -> Result<CoreKeySharePublicMaterial, JsValue> {
    let compressed = share.shared_public_key().to_bytes(true);
    let uncompressed = share.shared_public_key().to_bytes(false);
    let uncompressed_bytes = uncompressed.as_ref();
    if uncompressed_bytes.len() != 65 || uncompressed_bytes.first() != Some(&0x04) {
        return Err(JsValue::from_str("MPC_CGGMP24_INVALID_PUBLIC_KEY_ENCODING"));
    }
    let hash = Keccak256::digest(&uncompressed_bytes[1..]);
    let address = &hash[hash.len() - 20..];
    Ok(CoreKeySharePublicMaterial {
        curve: "secp256k1".to_string(),
        compressed_public_key_hex: hex::encode(compressed.as_ref()),
        uncompressed_public_key_hex: hex::encode(uncompressed_bytes),
        ethereum_address: format!("0x{}", hex::encode(address)),
    })
}

#[wasm_bindgen(js_name = cggmp24EngineMetadataJson)]
pub fn cggmp24_engine_metadata_json() -> Result<String, JsValue> {
    serde_json::to_string(&WasmEngineMetadata {
        engine: ENGINE_ID.to_string(),
        protocol_version: PROTOCOL_VERSION,
        curve: "secp256k1".to_string(),
        security_profile: SECURITY_PROFILE.to_string(),
        production_safe: SECURITY_PROFILE_PRODUCTION_SAFE,
        rsa_prime_bitlen: RSA_PRIME_BITLEN,
        rsa_pubkey_bitlen: RSA_PUBKEY_BITLEN,
        protocols: vec![
            MpcProtocolKind::Keygen,
            MpcProtocolKind::AuxInfo,
            MpcProtocolKind::Sign,
        ],
        state_machine_api: vec![
            "startKeygen".to_string(),
            "startSign".to_string(),
            "receiveMessage".to_string(),
            "advance".to_string(),
            "getOutgoingMessages".to_string(),
            "getResult".to_string(),
            "coreKeySharePublicMaterial".to_string(),
            "combineKeyShare".to_string(),
            "startAuxInfo".to_string(),
        ],
    })
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = normalizeWireMessageJson)]
pub fn normalize_wire_message_json(json: &str) -> Result<String, JsValue> {
    let message: MpcWireMessage<serde_json::Value> =
        serde_json::from_str(json).map_err(to_js_error)?;
    if message.protocol_version != PROTOCOL_VERSION {
        return Err(JsValue::from_str("MPC_WIRE_PROTOCOL_VERSION_UNSUPPORTED"));
    }
    if message.engine != ENGINE_ID {
        return Err(JsValue::from_str("MPC_WIRE_ENGINE_UNSUPPORTED"));
    }
    serde_json::to_string(&message).map_err(to_js_error)
}

#[wasm_bindgen(js_name = normalizeSigningPayloadJson)]
pub fn normalize_signing_payload_json(json: &str) -> Result<String, JsValue> {
    let message: SecpSigningMessage = serde_json::from_str(json).map_err(to_js_error)?;
    serde_json::to_string(&message).map_err(to_js_error)
}

#[wasm_bindgen(js_name = normalizeThresholdKeygenPayloadJson)]
pub fn normalize_threshold_keygen_payload_json(json: &str) -> Result<String, JsValue> {
    let message: SecpThresholdKeygenMessage = serde_json::from_str(json).map_err(to_js_error)?;
    serde_json::to_string(&message).map_err(to_js_error)
}

#[wasm_bindgen(js_name = normalizeAuxInfoPayloadJson)]
pub fn normalize_aux_info_payload_json(json: &str) -> Result<String, JsValue> {
    let message: SecpAuxInfoMessage = serde_json::from_str(json).map_err(to_js_error)?;
    serde_json::to_string(&message).map_err(to_js_error)
}

#[wasm_bindgen(js_name = coreKeySharePublicMaterialJson)]
pub fn core_key_share_public_material_json(json: &str) -> Result<String, JsValue> {
    let share: SecpCoreKeyShare = serde_json::from_str(json).map_err(to_js_error)?;
    let material = core_key_share_public_material(&share)?;
    serde_json::to_string(&material).map_err(to_js_error)
}

#[wasm_bindgen(js_name = combineKeyShareJson)]
pub fn combine_key_share_json(core_json: &str, aux_info_json: &str) -> Result<String, JsValue> {
    let core: SecpCoreKeyShare = serde_json::from_str(core_json).map_err(to_js_error)?;
    let aux_info: SecpAuxInfo = serde_json::from_str(aux_info_json).map_err(to_js_error)?;
    let key_share: SecpKeyShare =
        KeyShare::from_parts((core, aux_info)).map_err(to_js_error)?;
    let material = key_share_public_material(&key_share)?;
    let key_share_json = serde_json::to_value(&key_share).map_err(to_js_error)?;
    serde_json::to_string(&CombinedKeyShareJson {
        status: "completed".to_string(),
        curve: material.curve,
        key_share: key_share_json,
        compressed_public_key_hex: material.compressed_public_key_hex,
        uncompressed_public_key_hex: material.uncompressed_public_key_hex,
        ethereum_address: material.ethereum_address,
    })
    .map_err(to_js_error)
}

#[wasm_bindgen(js_name = devTrustedAuxInfoJson)]
pub fn dev_trusted_aux_info_json(
    session_id: String,
    party_count: u16,
    participant_index: u16,
) -> Result<String, JsValue> {
    if session_id.trim().is_empty() {
        return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
    }
    if party_count == 0 || participant_index >= party_count {
        return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
    }
    let mut hasher = Sha256::new();
    hasher.update(b"yeying:cggmp24:dev-trusted-aux-info:v1:");
    hasher.update(session_id.as_bytes());
    hasher.update(b":");
    hasher.update(party_count.to_be_bytes());
    let seed: [u8; 32] = hasher.finalize().into();
    let mut rng = StdRng::from_seed(seed);
    let aux_data = trusted_dealer::generate_aux_data::<SpikeSecurityLevel, _>(
        &mut rng,
        party_count,
        false,
    )
    .map_err(to_js_error)?;
    let aux_info = aux_data
        .get(usize::from(participant_index))
        .ok_or_else(|| JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"))?;
    serde_json::to_string(aux_info).map_err(to_js_error)
}

#[wasm_bindgen]
pub struct Cggmp24ThresholdKeygenSession {
    session_id: String,
    sender_index: u16,
    state: Option<SecpThresholdKeygenState>,
    outgoing: Vec<WasmOutgoingMessage>,
    result: Option<serde_json::Value>,
    status: String,
    error: Option<String>,
}

#[wasm_bindgen]
impl Cggmp24ThresholdKeygenSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        session_id: String,
        sender_index: u16,
        party_count: u16,
        threshold: u16,
    ) -> Result<Cggmp24ThresholdKeygenSession, JsValue> {
        if session_id.trim().is_empty() {
            return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
        }
        if party_count == 0 || sender_index >= party_count {
            return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
        }
        if threshold < 2 || threshold > party_count {
            return Err(JsValue::from_str("INVALID_MPC_THRESHOLD"));
        }

        let eid_bytes = format!("{}:keygen:0", session_id).into_bytes();
        let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
        let rng: &'static mut OsRng = Box::leak(Box::new(OsRng));
        let state = cggmp24_keygen::KeygenBuilder::<
            Secp256k1,
            SpikeSecurityLevel,
            Sha256,
        >::new(cggmp24_keygen::ExecutionId::new(eid_bytes), sender_index, party_count)
        .set_threshold(threshold)
        .enforce_reliable_broadcast(false)
        .into_state_machine(rng);

        Ok(Cggmp24ThresholdKeygenSession {
            session_id,
            sender_index,
            state: Some(Box::new(state)),
            outgoing: Vec::new(),
            result: None,
            status: "running".to_string(),
            error: None,
        })
    }

    #[wasm_bindgen(js_name = newWithSeed)]
    pub fn new_with_seed(
        session_id: String,
        sender_index: u16,
        party_count: u16,
        threshold: u16,
        seed_hex: String,
    ) -> Result<Cggmp24ThresholdKeygenSession, JsValue> {
        if session_id.trim().is_empty() {
            return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
        }
        if party_count == 0 || sender_index >= party_count {
            return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
        }
        if threshold < 2 || threshold > party_count {
            return Err(JsValue::from_str("INVALID_MPC_THRESHOLD"));
        }

        let eid_bytes = format!("{}:keygen:0", session_id).into_bytes();
        let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
        let rng: &'static mut StdRng = Box::leak(Box::new(rng_from_seed_hex(&seed_hex)?));
        let state = cggmp24_keygen::KeygenBuilder::<
            Secp256k1,
            SpikeSecurityLevel,
            Sha256,
        >::new(cggmp24_keygen::ExecutionId::new(eid_bytes), sender_index, party_count)
        .set_threshold(threshold)
        .enforce_reliable_broadcast(false)
        .into_state_machine(rng);

        Ok(Cggmp24ThresholdKeygenSession {
            session_id,
            sender_index,
            state: Some(Box::new(state)),
            outgoing: Vec::new(),
            result: None,
            status: "running".to_string(),
            error: None,
        })
    }

    #[wasm_bindgen(js_name = advanceJson)]
    pub fn advance_json(&mut self, max_steps: u32) -> Result<String, JsValue> {
        let steps = max_steps.max(1).min(1000);
        for _ in 0..steps {
            if self.result.is_some() || self.error.is_some() {
                break;
            }
            let state = self
                .state
                .as_mut()
                .ok_or_else(|| JsValue::from_str("MPC_KEYGEN_STATE_NOT_STARTED"))?;
            match state.proceed() {
                ProceedResult::SendMsg(message) => {
                    self.outgoing.push(Self::outgoing_to_json(message)?);
                    self.status = "running".to_string();
                }
                ProceedResult::NeedsOneMoreMessage => {
                    self.status = "waiting".to_string();
                    break;
                }
                ProceedResult::Output(Ok(share)) => {
                    self.result = Some(serde_json::to_value(share).map_err(to_js_error)?);
                    self.status = "completed".to_string();
                    break;
                }
                ProceedResult::Output(Err(error)) => {
                    self.error = Some(error_chain_to_string(&error));
                    self.status = "error".to_string();
                    break;
                }
                ProceedResult::Yielded => {
                    self.status = "running".to_string();
                }
                ProceedResult::Error(error) => {
                    self.error = Some(format!("{error:?}"));
                    self.status = "error".to_string();
                    break;
                }
            }
        }
        self.snapshot_json()
    }

    #[wasm_bindgen(js_name = receiveWireMessageJson)]
    pub fn receive_wire_message_json(&mut self, json: &str) -> Result<String, JsValue> {
        let wire: MpcWireMessage<serde_json::Value> =
            serde_json::from_str(json).map_err(to_js_error)?;
        if wire.protocol_version != PROTOCOL_VERSION {
            return Err(JsValue::from_str("MPC_WIRE_PROTOCOL_VERSION_UNSUPPORTED"));
        }
        if wire.engine != ENGINE_ID {
            return Err(JsValue::from_str("MPC_WIRE_ENGINE_UNSUPPORTED"));
        }
        if wire.session_id != self.session_id {
            return Err(JsValue::from_str("MPC_WIRE_SESSION_MISMATCH"));
        }
        if wire.sender_index == self.sender_index {
            return Err(JsValue::from_str("MPC_WIRE_SELF_MESSAGE_REJECTED"));
        }
        let message: SecpThresholdKeygenMessage =
            serde_json::from_value(wire.payload).map_err(to_js_error)?;
        let msg_type = match wire.audience {
            MpcMessageAudience::AllParties => MessageType::Broadcast,
            MpcMessageAudience::OneParty { recipient_index } => {
                if recipient_index != self.sender_index {
                    return Err(JsValue::from_str("MPC_WIRE_RECIPIENT_MISMATCH"));
                }
                MessageType::P2P
            }
        };
        let incoming = Incoming {
            id: wire.sequence,
            sender: wire.sender_index,
            msg_type,
            msg: message,
        };
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("MPC_KEYGEN_STATE_NOT_STARTED"))?;
        state
            .received_msg(incoming)
            .map_err(|_| JsValue::from_str("MPC_KEYGEN_UNEXPECTED_MESSAGE"))?;
        self.status = "running".to_string();
        self.snapshot_json()
    }

    #[wasm_bindgen(js_name = drainOutgoingJson)]
    pub fn drain_outgoing_json(&mut self) -> Result<String, JsValue> {
        let outgoing = core::mem::take(&mut self.outgoing);
        serde_json::to_string(&outgoing).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = resultJson)]
    pub fn result_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.result).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = status)]
    pub fn status(&self) -> String {
        self.status.clone()
    }
}

impl Cggmp24ThresholdKeygenSession {
    fn outgoing_to_json(
        message: round_based::Outgoing<SecpThresholdKeygenMessage>,
    ) -> Result<WasmOutgoingMessage, JsValue> {
        let audience = match message.recipient {
            MessageDestination::AllParties => MpcMessageAudience::AllParties,
            MessageDestination::OneParty(recipient_index) => {
                MpcMessageAudience::OneParty { recipient_index }
            }
        };
        Ok(WasmOutgoingMessage {
            audience,
            payload: serde_json::to_value(message.msg).map_err(to_js_error)?,
        })
    }

    fn snapshot_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&WasmAdvanceResult {
            status: self.status.clone(),
            outgoing: self.outgoing.clone(),
            result: self.result.clone(),
            error: self.error.clone(),
        })
        .map_err(to_js_error)
    }
}

#[wasm_bindgen]
pub struct Cggmp24AuxInfoSession {
    session_id: String,
    sender_index: u16,
    state: Option<SecpAuxInfoState>,
    outgoing: Vec<WasmOutgoingMessage>,
    result: Option<serde_json::Value>,
    status: String,
    error: Option<String>,
}

#[wasm_bindgen]
impl Cggmp24AuxInfoSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        session_id: String,
        sender_index: u16,
        party_count: u16,
    ) -> Result<Cggmp24AuxInfoSession, JsValue> {
        if session_id.trim().is_empty() {
            return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
        }
        if party_count == 0 || sender_index >= party_count {
            return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
        }

        let eid_bytes = format!("{}:aux-info:0", session_id).into_bytes();
        let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
        let rng: &'static mut OsRng = Box::leak(Box::new(OsRng));
        let pregenerated =
            cggmp24::key_refresh::PregeneratedPrimes::<SpikeSecurityLevel>::generate(rng);
        let state = aux_info_gen::<SpikeSecurityLevel>(
            ExecutionId::new(eid_bytes),
            sender_index,
            party_count,
            pregenerated,
        )
        .set_digest::<Sha256>()
        .enforce_reliable_broadcast(false)
        .into_state_machine(rng);

        Ok(Cggmp24AuxInfoSession {
            session_id,
            sender_index,
            state: Some(Box::new(state)),
            outgoing: Vec::new(),
            result: None,
            status: "running".to_string(),
            error: None,
        })
    }

    #[wasm_bindgen(js_name = newWithSeed)]
    pub fn new_with_seed(
        session_id: String,
        sender_index: u16,
        party_count: u16,
        seed_hex: String,
    ) -> Result<Cggmp24AuxInfoSession, JsValue> {
        if session_id.trim().is_empty() {
            return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
        }
        if party_count == 0 || sender_index >= party_count {
            return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
        }

        let eid_bytes = format!("{}:aux-info:0", session_id).into_bytes();
        let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
        let rng: &'static mut StdRng = Box::leak(Box::new(rng_from_seed_hex(&seed_hex)?));
        let pregenerated =
            cggmp24::key_refresh::PregeneratedPrimes::<SpikeSecurityLevel>::generate(rng);
        let state = aux_info_gen::<SpikeSecurityLevel>(
            ExecutionId::new(eid_bytes),
            sender_index,
            party_count,
            pregenerated,
        )
        .set_digest::<Sha256>()
        .enforce_reliable_broadcast(false)
        .into_state_machine(rng);

        Ok(Cggmp24AuxInfoSession {
            session_id,
            sender_index,
            state: Some(Box::new(state)),
            outgoing: Vec::new(),
            result: None,
            status: "running".to_string(),
            error: None,
        })
    }

    #[wasm_bindgen(js_name = advanceJson)]
    pub fn advance_json(&mut self, max_steps: u32) -> Result<String, JsValue> {
        let steps = max_steps.max(1).min(1000);
        for _ in 0..steps {
            if self.result.is_some() || self.error.is_some() {
                break;
            }
            let state = self
                .state
                .as_mut()
                .ok_or_else(|| JsValue::from_str("MPC_AUX_INFO_STATE_NOT_STARTED"))?;
            match state.proceed() {
                ProceedResult::SendMsg(message) => {
                    self.outgoing.push(Self::outgoing_to_json(message)?);
                    self.status = "running".to_string();
                }
                ProceedResult::NeedsOneMoreMessage => {
                    self.status = "waiting".to_string();
                    break;
                }
                ProceedResult::Output(Ok(aux_info)) => {
                    self.result = Some(serde_json::to_value(aux_info).map_err(to_js_error)?);
                    self.status = "completed".to_string();
                    break;
                }
                ProceedResult::Output(Err(error)) => {
                    self.error = Some(error_chain_to_string(&error));
                    self.status = "error".to_string();
                    break;
                }
                ProceedResult::Yielded => {
                    self.status = "running".to_string();
                }
                ProceedResult::Error(error) => {
                    self.error = Some(format!("{error:?}"));
                    self.status = "error".to_string();
                    break;
                }
            }
        }
        self.snapshot_json()
    }

    #[wasm_bindgen(js_name = receiveWireMessageJson)]
    pub fn receive_wire_message_json(&mut self, json: &str) -> Result<String, JsValue> {
        let wire: MpcWireMessage<serde_json::Value> =
            serde_json::from_str(json).map_err(to_js_error)?;
        if wire.protocol_version != PROTOCOL_VERSION {
            return Err(JsValue::from_str("MPC_WIRE_PROTOCOL_VERSION_UNSUPPORTED"));
        }
        if wire.engine != ENGINE_ID {
            return Err(JsValue::from_str("MPC_WIRE_ENGINE_UNSUPPORTED"));
        }
        if wire.session_id != self.session_id {
            return Err(JsValue::from_str("MPC_WIRE_SESSION_MISMATCH"));
        }
        if wire.protocol != MpcProtocolKind::AuxInfo {
            return Err(JsValue::from_str("MPC_WIRE_PROTOCOL_MISMATCH"));
        }
        if wire.sender_index == self.sender_index {
            return Err(JsValue::from_str("MPC_WIRE_SELF_MESSAGE_REJECTED"));
        }
        let message: SecpAuxInfoMessage = serde_json::from_value(wire.payload).map_err(to_js_error)?;
        let msg_type = match wire.audience {
            MpcMessageAudience::AllParties => MessageType::Broadcast,
            MpcMessageAudience::OneParty { recipient_index } => {
                if recipient_index != self.sender_index {
                    return Err(JsValue::from_str("MPC_WIRE_RECIPIENT_MISMATCH"));
                }
                MessageType::P2P
            }
        };
        let incoming = Incoming {
            id: wire.sequence,
            sender: wire.sender_index,
            msg_type,
            msg: message,
        };
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("MPC_AUX_INFO_STATE_NOT_STARTED"))?;
        state
            .received_msg(incoming)
            .map_err(|_| JsValue::from_str("MPC_AUX_INFO_UNEXPECTED_MESSAGE"))?;
        self.status = "running".to_string();
        self.snapshot_json()
    }

    #[wasm_bindgen(js_name = drainOutgoingJson)]
    pub fn drain_outgoing_json(&mut self) -> Result<String, JsValue> {
        let outgoing = core::mem::take(&mut self.outgoing);
        serde_json::to_string(&outgoing).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = resultJson)]
    pub fn result_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.result).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = status)]
    pub fn status(&self) -> String {
        self.status.clone()
    }
}

impl Cggmp24AuxInfoSession {
    fn outgoing_to_json(
        message: round_based::Outgoing<SecpAuxInfoMessage>,
    ) -> Result<WasmOutgoingMessage, JsValue> {
        let audience = match message.recipient {
            MessageDestination::AllParties => MpcMessageAudience::AllParties,
            MessageDestination::OneParty(recipient_index) => {
                MpcMessageAudience::OneParty { recipient_index }
            }
        };
        Ok(WasmOutgoingMessage {
            audience,
            payload: serde_json::to_value(message.msg).map_err(to_js_error)?,
        })
    }

    fn snapshot_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&WasmAdvanceResult {
            status: self.status.clone(),
            outgoing: self.outgoing.clone(),
            result: self.result.clone(),
            error: self.error.clone(),
        })
        .map_err(to_js_error)
    }
}

#[wasm_bindgen]
pub struct Cggmp24SigningSession {
    session_id: String,
    sender_index: u16,
    state: Option<SecpSigningState>,
    outgoing: Vec<WasmOutgoingMessage>,
    result: Option<serde_json::Value>,
    status: String,
    error: Option<String>,
}

#[wasm_bindgen]
impl Cggmp24SigningSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        session_id: String,
        request_id: String,
        sender_index: u16,
        parties_json: String,
        key_share_json: String,
        message_hex: String,
    ) -> Result<Cggmp24SigningSession, JsValue> {
        if session_id.trim().is_empty() {
            return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
        }
        let parties: Vec<u16> = serde_json::from_str(&parties_json).map_err(to_js_error)?;
        if parties.is_empty() || usize::from(sender_index) >= parties.len() {
            return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
        }
        let key_share: SecpKeyShare = serde_json::from_str(&key_share_json).map_err(to_js_error)?;
        let message_hex = message_hex.trim().strip_prefix("0x").unwrap_or(message_hex.trim());
        let message = hex::decode(message_hex).map_err(to_js_error)?;

        let eid_bytes = format!("{}:sign:{}:0", session_id, request_id).into_bytes();
        let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
        let parties: &'static [u16] = Box::leak(parties.into_boxed_slice());
        let key_share: &'static SecpKeyShare = Box::leak(Box::new(key_share));
        let message_to_sign: &'static DataToSign<Secp256k1> =
            Box::leak(Box::new(DataToSign::<Secp256k1>::digest::<Sha256>(&message)));
        let rng: &'static mut OsRng = Box::leak(Box::new(OsRng));
        let state = signing(
            ExecutionId::new(eid_bytes),
            sender_index,
            parties,
            key_share,
        )
        .set_digest::<Sha256>()
        .enforce_reliable_broadcast(false)
        .sign_sync(rng, message_to_sign);

        Ok(Cggmp24SigningSession {
            session_id,
            sender_index,
            state: Some(Box::new(state)),
            outgoing: Vec::new(),
            result: None,
            status: "running".to_string(),
            error: None,
        })
    }

    #[wasm_bindgen(js_name = newWithSeed)]
    pub fn new_with_seed(
        session_id: String,
        request_id: String,
        sender_index: u16,
        parties_json: String,
        key_share_json: String,
        message_hex: String,
        seed_hex: String,
    ) -> Result<Cggmp24SigningSession, JsValue> {
        if session_id.trim().is_empty() {
            return Err(JsValue::from_str("MPC_SESSION_ID_REQUIRED"));
        }
        let parties: Vec<u16> = serde_json::from_str(&parties_json).map_err(to_js_error)?;
        if parties.is_empty() || usize::from(sender_index) >= parties.len() {
            return Err(JsValue::from_str("INVALID_MPC_PARTICIPANT_INDEX"));
        }
        let key_share: SecpKeyShare = serde_json::from_str(&key_share_json).map_err(to_js_error)?;
        let message_hex = message_hex.trim().strip_prefix("0x").unwrap_or(message_hex.trim());
        let message = hex::decode(message_hex).map_err(to_js_error)?;

        let eid_bytes = format!("{}:sign:{}:0", session_id, request_id).into_bytes();
        let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
        let parties: &'static [u16] = Box::leak(parties.into_boxed_slice());
        let key_share: &'static SecpKeyShare = Box::leak(Box::new(key_share));
        let message_to_sign: &'static DataToSign<Secp256k1> =
            Box::leak(Box::new(DataToSign::<Secp256k1>::digest::<Sha256>(&message)));
        let rng: &'static mut StdRng = Box::leak(Box::new(rng_from_seed_hex(&seed_hex)?));
        let state = signing(
            ExecutionId::new(eid_bytes),
            sender_index,
            parties,
            key_share,
        )
        .set_digest::<Sha256>()
        .enforce_reliable_broadcast(false)
        .sign_sync(rng, message_to_sign);

        Ok(Cggmp24SigningSession {
            session_id,
            sender_index,
            state: Some(Box::new(state)),
            outgoing: Vec::new(),
            result: None,
            status: "running".to_string(),
            error: None,
        })
    }

    #[wasm_bindgen(js_name = advanceJson)]
    pub fn advance_json(&mut self, max_steps: u32) -> Result<String, JsValue> {
        let steps = max_steps.max(1).min(1000);
        for _ in 0..steps {
            if self.result.is_some() || self.error.is_some() {
                break;
            }
            let state = self
                .state
                .as_mut()
                .ok_or_else(|| JsValue::from_str("MPC_SIGNING_STATE_NOT_STARTED"))?;
            match state.proceed() {
                ProceedResult::SendMsg(message) => {
                    self.outgoing.push(Self::outgoing_to_json(message)?);
                    self.status = "running".to_string();
                }
                ProceedResult::NeedsOneMoreMessage => {
                    self.status = "waiting".to_string();
                    break;
                }
                ProceedResult::Output(Ok(signature)) => {
                    let mut bytes = vec![0u8; SecpSignature::serialized_len()];
                    signature.write_to_slice(&mut bytes);
                    self.result = Some(serde_json::json!({
                        "signature": signature,
                        "signatureHex": format!("0x{}", hex::encode(bytes)),
                    }));
                    self.status = "completed".to_string();
                    break;
                }
                ProceedResult::Output(Err(error)) => {
                    self.error = Some(error_chain_to_string(&error));
                    self.status = "error".to_string();
                    break;
                }
                ProceedResult::Yielded => {
                    self.status = "running".to_string();
                }
                ProceedResult::Error(error) => {
                    self.error = Some(format!("{error:?}"));
                    self.status = "error".to_string();
                    break;
                }
            }
        }
        self.snapshot_json()
    }

    #[wasm_bindgen(js_name = receiveWireMessageJson)]
    pub fn receive_wire_message_json(&mut self, json: &str) -> Result<String, JsValue> {
        let wire: MpcWireMessage<serde_json::Value> =
            serde_json::from_str(json).map_err(to_js_error)?;
        if wire.protocol_version != PROTOCOL_VERSION {
            return Err(JsValue::from_str("MPC_WIRE_PROTOCOL_VERSION_UNSUPPORTED"));
        }
        if wire.engine != ENGINE_ID {
            return Err(JsValue::from_str("MPC_WIRE_ENGINE_UNSUPPORTED"));
        }
        if wire.session_id != self.session_id {
            return Err(JsValue::from_str("MPC_WIRE_SESSION_MISMATCH"));
        }
        if wire.protocol != MpcProtocolKind::Sign {
            return Err(JsValue::from_str("MPC_WIRE_PROTOCOL_MISMATCH"));
        }
        if wire.sender_index == self.sender_index {
            return Err(JsValue::from_str("MPC_WIRE_SELF_MESSAGE_REJECTED"));
        }
        let message: SecpSigningMessage = serde_json::from_value(wire.payload).map_err(to_js_error)?;
        let msg_type = match wire.audience {
            MpcMessageAudience::AllParties => MessageType::Broadcast,
            MpcMessageAudience::OneParty { recipient_index } => {
                if recipient_index != self.sender_index {
                    return Err(JsValue::from_str("MPC_WIRE_RECIPIENT_MISMATCH"));
                }
                MessageType::P2P
            }
        };
        let incoming = Incoming {
            id: wire.sequence,
            sender: wire.sender_index,
            msg_type,
            msg: message,
        };
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| JsValue::from_str("MPC_SIGNING_STATE_NOT_STARTED"))?;
        state
            .received_msg(incoming)
            .map_err(|_| JsValue::from_str("MPC_SIGNING_UNEXPECTED_MESSAGE"))?;
        self.status = "running".to_string();
        self.snapshot_json()
    }

    #[wasm_bindgen(js_name = drainOutgoingJson)]
    pub fn drain_outgoing_json(&mut self) -> Result<String, JsValue> {
        let outgoing = core::mem::take(&mut self.outgoing);
        serde_json::to_string(&outgoing).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = resultJson)]
    pub fn result_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.result).map_err(to_js_error)
    }

    #[wasm_bindgen(js_name = status)]
    pub fn status(&self) -> String {
        self.status.clone()
    }
}

impl Cggmp24SigningSession {
    fn outgoing_to_json(
        message: round_based::Outgoing<SecpSigningMessage>,
    ) -> Result<WasmOutgoingMessage, JsValue> {
        let audience = match message.recipient {
            MessageDestination::AllParties => MpcMessageAudience::AllParties,
            MessageDestination::OneParty(recipient_index) => {
                MpcMessageAudience::OneParty { recipient_index }
            }
        };
        Ok(WasmOutgoingMessage {
            audience,
            payload: serde_json::to_value(message.msg).map_err(to_js_error)?,
        })
    }

    fn snapshot_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&WasmAdvanceResult {
            status: self.status.clone(),
            outgoing: self.outgoing.clone(),
            result: self.result.clone(),
            error: self.error.clone(),
        })
        .map_err(to_js_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Debug, Clone, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TestAdvanceResult {
        status: String,
        outgoing: Vec<WasmOutgoingMessage>,
        result: Option<serde_json::Value>,
        error: Option<String>,
    }

    fn parse_advance(json: String) -> TestAdvanceResult {
        serde_json::from_str(&json).expect("advance result should deserialize")
    }

    fn make_wire(
        session_id: &str,
        sequence: u64,
        sender_index: u16,
        outgoing: WasmOutgoingMessage,
    ) -> MpcWireMessage<serde_json::Value> {
        MpcWireMessage {
            protocol_version: PROTOCOL_VERSION,
            engine: ENGINE_ID.to_string(),
            session_id: session_id.to_string(),
            protocol: MpcProtocolKind::Keygen,
            sequence,
            sender_index,
            audience: outgoing.audience,
            payload: outgoing.payload,
        }
    }

    fn enqueue_outgoing(
        queue: &mut VecDeque<MpcWireMessage<serde_json::Value>>,
        session_id: &str,
        sequence: &mut u64,
        sender_index: u16,
        outgoing: Vec<WasmOutgoingMessage>,
    ) {
        for message in outgoing {
            *sequence += 1;
            queue.push_back(make_wire(session_id, *sequence, sender_index, message));
        }
    }

    #[test]
    fn wire_message_envelope_serializes_stable_protocol_fields() {
        let envelope = MpcWireMessage::sign_p2p(
            "session-1",
            7,
            0,
            1,
            serde_json::json!({
                "round": "round1b",
                "ciphertext": "opaque-cggmp24-message"
            }),
        );

        let encoded = serde_json::to_string(&envelope).expect("wire envelope should serialize");
        let decoded: MpcWireMessage<serde_json::Value> =
            serde_json::from_str(&encoded).expect("wire envelope should deserialize");

        assert_eq!(decoded.protocol_version, PROTOCOL_VERSION);
        assert_eq!(decoded.engine, ENGINE_ID);
        assert_eq!(decoded.session_id, "session-1");
        assert_eq!(decoded.protocol, MpcProtocolKind::Sign);
        assert_eq!(
            decoded.audience,
            MpcMessageAudience::OneParty { recipient_index: 1 }
        );
        assert_eq!(decoded.payload["round"], "round1b");
    }

    #[test]
    fn threshold_keygen_state_machine_completes_2_of_2() {
        let session_id = "session-keygen-smoke";
        let mut party0 = Cggmp24ThresholdKeygenSession::new(session_id.to_string(), 0, 2, 2)
            .expect("party0 should start");
        let mut party1 = Cggmp24ThresholdKeygenSession::new(session_id.to_string(), 1, 2, 2)
            .expect("party1 should start");
        let mut sequence = 0;
        let mut queue = VecDeque::new();

        let first0 = parse_advance(party0.advance_json(100).expect("party0 should advance"));
        let first1 = parse_advance(party1.advance_json(100).expect("party1 should advance"));
        assert_eq!(first0.status, "waiting");
        assert_eq!(first1.status, "waiting");
        assert!(first0.result.is_none());
        assert!(first1.result.is_none());
        enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, first0.outgoing);
        enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, first1.outgoing);

        for _ in 0..200 {
            if party0.status() == "completed" && party1.status() == "completed" {
                break;
            }
            let Some(wire) = queue.pop_front() else {
                let tick0 = parse_advance(party0.advance_json(100).expect("party0 tick"));
                let tick1 = parse_advance(party1.advance_json(100).expect("party1 tick"));
                assert!(tick0.error.is_none(), "party0 error: {:?}", tick0.error);
                assert!(tick1.error.is_none(), "party1 error: {:?}", tick1.error);
                enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, tick0.outgoing);
                enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, tick1.outgoing);
                continue;
            };
            let encoded = serde_json::to_string(&wire).expect("wire should serialize");
            match wire.audience {
                MpcMessageAudience::AllParties => {
                    if wire.sender_index != 0 {
                        let result = parse_advance(
                            party0
                                .receive_wire_message_json(&encoded)
                                .expect("party0 should receive broadcast"),
                        );
                        assert!(result.error.is_none(), "party0 receive error: {:?}", result.error);
                        let tick = parse_advance(party0.advance_json(100).expect("party0 tick"));
                        enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, tick.outgoing);
                    }
                    if wire.sender_index != 1 {
                        let result = parse_advance(
                            party1
                                .receive_wire_message_json(&encoded)
                                .expect("party1 should receive broadcast"),
                        );
                        assert!(result.error.is_none(), "party1 receive error: {:?}", result.error);
                        let tick = parse_advance(party1.advance_json(100).expect("party1 tick"));
                        enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, tick.outgoing);
                    }
                }
                MpcMessageAudience::OneParty { recipient_index: 0 } => {
                    let result = parse_advance(
                        party0
                            .receive_wire_message_json(&encoded)
                            .expect("party0 should receive p2p"),
                    );
                    assert!(result.error.is_none(), "party0 receive error: {:?}", result.error);
                    let tick = parse_advance(party0.advance_json(100).expect("party0 tick"));
                    enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, tick.outgoing);
                }
                MpcMessageAudience::OneParty { recipient_index: 1 } => {
                    let result = parse_advance(
                        party1
                            .receive_wire_message_json(&encoded)
                            .expect("party1 should receive p2p"),
                    );
                    assert!(result.error.is_none(), "party1 receive error: {:?}", result.error);
                    let tick = parse_advance(party1.advance_json(100).expect("party1 tick"));
                    enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, tick.outgoing);
                }
                MpcMessageAudience::OneParty { recipient_index } => {
                    panic!("unexpected recipient {recipient_index}");
                }
            }
        }

        assert_eq!(party0.status(), "completed");
        assert_eq!(party1.status(), "completed");
        let result0: serde_json::Value =
            serde_json::from_str(&party0.result_json().expect("party0 result json")).unwrap();
        let result1: serde_json::Value =
            serde_json::from_str(&party1.result_json().expect("party1 result json")).unwrap();
        assert!(result0.is_object());
        assert!(result1.is_object());
        assert_eq!(
            result0["shared_public_key"],
            result1["shared_public_key"],
            "parties should derive the same shared public key"
        );
        let material0: CoreKeySharePublicMaterial = serde_json::from_str(
            &core_key_share_public_material_json(
                &serde_json::to_string(&result0).expect("party0 result should serialize"),
            )
            .expect("party0 public material should export"),
        )
        .expect("party0 public material should deserialize");
        let material1: CoreKeySharePublicMaterial = serde_json::from_str(
            &core_key_share_public_material_json(
                &serde_json::to_string(&result1).expect("party1 result should serialize"),
            )
            .expect("party1 public material should export"),
        )
        .expect("party1 public material should deserialize");
        assert_eq!(material0.curve, "secp256k1");
        assert_eq!(material0.compressed_public_key_hex.len(), 66);
        assert_eq!(material0.uncompressed_public_key_hex.len(), 130);
        assert!(material0.uncompressed_public_key_hex.starts_with("04"));
        assert!(material0.ethereum_address.starts_with("0x"));
        assert_eq!(material0.ethereum_address.len(), 42);
        assert_eq!(material0, material1);
    }

    #[test]
    #[ignore = "cggmp24 alpha.3 aux_info_gen fails Rfac proof with dev-sized Paillier parameters; dev trusted aux fallback is used for browser verification."]
    fn aux_info_state_machine_completes_2_of_2() {
        let session_id = "session-aux-info-smoke";
        let mut party0 = Cggmp24AuxInfoSession::new(session_id.to_string(), 0, 2)
            .expect("party0 should start");
        let mut party1 = Cggmp24AuxInfoSession::new(session_id.to_string(), 1, 2)
            .expect("party1 should start");
        let mut sequence = 0;
        let mut queue = VecDeque::new();

        let first0 = parse_advance(party0.advance_json(100).expect("party0 should advance"));
        let first1 = parse_advance(party1.advance_json(100).expect("party1 should advance"));
        assert!(first0.error.is_none(), "party0 first error: {:?}", first0.error);
        assert!(first1.error.is_none(), "party1 first error: {:?}", first1.error);
        enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, first0.outgoing);
        enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, first1.outgoing);

        for _ in 0..200 {
            if party0.status() == "completed" && party1.status() == "completed" {
                break;
            }
            let Some(mut wire) = queue.pop_front() else {
                let tick0 = parse_advance(party0.advance_json(100).expect("party0 tick"));
                let tick1 = parse_advance(party1.advance_json(100).expect("party1 tick"));
                assert!(tick0.error.is_none(), "party0 error: {:?}", tick0.error);
                assert!(tick1.error.is_none(), "party1 error: {:?}", tick1.error);
                enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, tick0.outgoing);
                enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, tick1.outgoing);
                continue;
            };
            wire.protocol = MpcProtocolKind::AuxInfo;
            let encoded = serde_json::to_string(&wire).expect("wire should serialize");
            match wire.audience {
                MpcMessageAudience::AllParties => {
                    if wire.sender_index != 0 {
                        let result = parse_advance(
                            party0
                                .receive_wire_message_json(&encoded)
                                .expect("party0 should receive broadcast"),
                        );
                        assert!(result.error.is_none(), "party0 receive error: {:?}", result.error);
                        let tick = parse_advance(party0.advance_json(100).expect("party0 tick"));
                        assert!(tick.error.is_none(), "party0 tick error: {:?}", tick.error);
                        enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, tick.outgoing);
                    }
                    if wire.sender_index != 1 {
                        let result = parse_advance(
                            party1
                                .receive_wire_message_json(&encoded)
                                .expect("party1 should receive broadcast"),
                        );
                        assert!(result.error.is_none(), "party1 receive error: {:?}", result.error);
                        let tick = parse_advance(party1.advance_json(100).expect("party1 tick"));
                        assert!(tick.error.is_none(), "party1 tick error: {:?}", tick.error);
                        enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, tick.outgoing);
                    }
                }
                MpcMessageAudience::OneParty { recipient_index: 0 } => {
                    let result = parse_advance(
                        party0
                            .receive_wire_message_json(&encoded)
                            .expect("party0 should receive p2p"),
                    );
                    assert!(result.error.is_none(), "party0 receive error: {:?}", result.error);
                    let tick = parse_advance(party0.advance_json(100).expect("party0 tick"));
                    assert!(tick.error.is_none(), "party0 tick error: {:?}", tick.error);
                    enqueue_outgoing(&mut queue, session_id, &mut sequence, 0, tick.outgoing);
                }
                MpcMessageAudience::OneParty { recipient_index: 1 } => {
                    let result = parse_advance(
                        party1
                            .receive_wire_message_json(&encoded)
                            .expect("party1 should receive p2p"),
                    );
                    assert!(result.error.is_none(), "party1 receive error: {:?}", result.error);
                    let tick = parse_advance(party1.advance_json(100).expect("party1 tick"));
                    assert!(tick.error.is_none(), "party1 tick error: {:?}", tick.error);
                    enqueue_outgoing(&mut queue, session_id, &mut sequence, 1, tick.outgoing);
                }
                MpcMessageAudience::OneParty { recipient_index } => {
                    panic!("unexpected recipient {recipient_index}");
                }
            }
        }

        assert_eq!(party0.status(), "completed");
        assert_eq!(party1.status(), "completed");
    }

    #[test]
    #[ignore = "cggmp24 alpha.3 aux_info_gen fails Rfac proof with dev-sized Paillier parameters; dev trusted aux fallback is used for browser verification."]
    fn aux_info_official_sim_completes_2_of_2() {
        let session_id = "session-aux-info-official-sim";
        let setups = (0..2)
            .map(|index| {
                let mut rng = StdRng::from_seed([index + 1; 32]);
                let pregenerated =
                    cggmp24::key_refresh::PregeneratedPrimes::<SpikeSecurityLevel>::generate(
                        &mut rng,
                    );
                (rng, pregenerated)
            })
            .collect::<Vec<_>>();
        let result = round_based::sim::run_with_setup(
            setups,
            |i, party, (mut rng, pregenerated)| async move {
                let eid_bytes = format!("{}:aux-info:0", session_id).into_bytes();
                let eid_bytes: &'static [u8] = Box::leak(eid_bytes.into_boxed_slice());
                aux_info_gen::<SpikeSecurityLevel>(
                    ExecutionId::new(eid_bytes),
                    i,
                    2,
                    pregenerated,
                )
                .set_digest::<Sha256>()
                .enforce_reliable_broadcast(false)
                .start(&mut rng, party)
                .await
            },
        )
        .expect("simulation should run");
        let outputs = result.expect_ok();
        assert_eq!(outputs.0.len(), 2);
    }

    #[test]
    #[ignore = "diagnostic: run the library default SecurityLevel128 aux-info simulator"]
    fn aux_info_default_security_level_sim() {
        use cggmp24::security_level::SecurityLevel128;
        let result = round_based::sim::run_with_setup(
            (0..2).map(|index| {
                let mut rng = StdRng::from_seed([index + 11; 32]);
                let pregenerated = cggmp24::key_refresh::PregeneratedPrimes::<SecurityLevel128>::generate(&mut rng);
                (rng, pregenerated)
            }),
            |i, party, (mut rng, pregenerated)| async move {
                let eid = ExecutionId::new(b"default-level-aux-info");
                aux_info_gen::<SecurityLevel128>(eid, i, 2, pregenerated)
                    .set_digest::<Sha256>()
                    .enforce_reliable_broadcast(false)
                    .start(&mut rng, party)
                    .await
            },
        );
        result.expect("default security level simulator should complete");
    }

    #[test]
    #[ignore = "Runs real CGGMP24 auxiliary-data/signing work and takes several minutes locally."]
    fn cggmp24_trusted_dealer_signs_and_verifies_2_of_2() {
        let shares = trusted_dealer_2_of_2();
        assert_eq!(shares[0].min_signers(), 2);
        assert_eq!(shares[1].min_signers(), 2);
        assert_eq!(shares[0].shared_public_key(), shares[1].shared_public_key());

        let message = b"hello yeying mpc";
        let signature = sign_message_2_of_2(&shares, message);

        assert!(verify_signature(&shares[0], message, &signature));
        assert_eq!(serialize_signature_hex(&signature).len(), 128);
    }

    #[test]
    #[ignore = "Runs trusted-dealer auxiliary-data generation and can take minutes locally."]
    fn combine_key_share_json_rebuilds_trusted_dealer_share() {
        let shares = trusted_dealer_2_of_2();
        let core: SecpCoreKeyShare =
            <SecpKeyShare as AsRef<SecpCoreKeyShare>>::as_ref(&shares[0]).clone();
        let aux_info: SecpAuxInfo =
            <SecpKeyShare as AsRef<SecpAuxInfo>>::as_ref(&shares[0]).clone();
        let core_json = serde_json::to_string(&core).expect("core should serialize");
        let aux_info_json = serde_json::to_string(&aux_info).expect("aux-info should serialize");

        let combined: CombinedKeyShareJson = serde_json::from_str(
            &combine_key_share_json(&core_json, &aux_info_json).expect("share should combine"),
        )
        .expect("combined result should deserialize");

        assert_eq!(combined.status, "completed");
        assert_eq!(combined.curve, "secp256k1");
        assert_eq!(combined.compressed_public_key_hex.len(), 66);
        assert_eq!(combined.uncompressed_public_key_hex.len(), 130);
        assert!(combined.uncompressed_public_key_hex.starts_with("04"));
        assert_eq!(combined.ethereum_address.len(), 42);
        assert!(combined.key_share.get("core").is_some());
        assert!(combined.key_share.get("aux").is_some());
    }
}

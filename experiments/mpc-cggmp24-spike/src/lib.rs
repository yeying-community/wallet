use cggmp24::key_share::AnyKeyShare;
use cggmp24::supported_curves::Secp256k1;
use cggmp24::{signing, trusted_dealer, DataToSign, ExecutionId, KeyShare, Signature};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const ENGINE_ID: &str = "cggmp24";
pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone)]
pub struct SpikeSecurityLevel;

cggmp24::define_security_level!(SpikeSecurityLevel {
    kappa_bits: 128,
    rsa_prime_bitlen: 1536,
    rsa_pubkey_bitlen: 3071,
    epsilon: 256 * 2,
    ell: 256,
    ell_prime: 256 * 5,
    m: 128,
});

pub type SecpKeyShare = KeyShare<Secp256k1, SpikeSecurityLevel>;
pub type SecpSignature = Signature<Secp256k1>;
pub type SecpSigningMessage = cggmp24::signing::msg::Msg<Secp256k1, Sha256>;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}

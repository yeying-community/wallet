use cggmp24::key_share::AnyKeyShare;
use cggmp24::supported_curves::Secp256k1;
use cggmp24::{signing, trusted_dealer, DataToSign, ExecutionId, KeyShare, Signature};
use rand::rngs::OsRng;
use sha2::Sha256;

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

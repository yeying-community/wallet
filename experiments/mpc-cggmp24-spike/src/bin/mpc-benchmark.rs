use std::time::Instant;
use std::{sync::mpsc, thread, time::Duration};

use cggmp24::key_share::AnyKeyShare;
use mpc_cggmp24_spike::{
    sign_message_2_of_2, trusted_dealer_2_of_2, verify_signature,
};

fn main() {
    let started = Instant::now();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(trusted_dealer_2_of_2());
    });
    let shares = loop {
        match receiver.recv_timeout(Duration::from_secs(10)) {
            Ok(shares) => break shares,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                println!("aux_generation_heartbeat_ms={}", started.elapsed().as_millis());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                eprintln!("aux_generation_failed");
                std::process::exit(1);
            }
        }
    };
    let aux_ms = started.elapsed().as_millis();
    println!("aux_generation_ms={aux_ms}");
    println!("party_count={}", shares.len());
    println!("threshold={}", shares[0].min_signers());

    let message = b"yeying-mpc-native-benchmark";
    let signing_started = Instant::now();
    let signature = sign_message_2_of_2(&shares, message);
    let signing_ms = signing_started.elapsed().as_millis();
    let verified = verify_signature(&shares[0], message, &signature);
    println!("signing_ms={signing_ms}");
    println!("verify={verified}");
    println!("total_ms={}", started.elapsed().as_millis());

    if !verified {
        std::process::exit(2);
    }
}

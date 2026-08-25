#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="${TMPDIR:-/tmp}/mpc-cggmp24-production-$$"
mkdir -p "$RUN_DIR"
trap 'rm -rf "$RUN_DIR"' EXIT INT TERM

cp "$ROOT/Cargo.toml" "$ROOT/Cargo.lock" "$RUN_DIR/"
cp -R "$ROOT/src" "$ROOT/vendor" "$RUN_DIR/"

# Keep the working tree untouched; benchmark the production Paillier sizes.
sed -i '' \
  -e 's/SECURITY_PROFILE: &str = "dev-verification"/SECURITY_PROFILE: \&str = "verification-1536"/' \
  -e 's/RSA_PRIME_BITLEN: u32 = 256/RSA_PRIME_BITLEN: u32 = 1536/' \
  -e 's/RSA_PUBKEY_BITLEN: u32 = 511/RSA_PUBKEY_BITLEN: u32 = 3071/' \
  "$RUN_DIR/src/lib.rs"

echo "production benchmark directory: $RUN_DIR"
echo "parameters: rsa_prime_bitlen=1536 rsa_pubkey_bitlen=3071"
echo "started_at: $(date)"
cd "$RUN_DIR"
PATH="$HOME/.cargo/bin:$PATH" cargo run --release --bin mpc-benchmark
status=$?
echo "finished_at: $(date)"
echo "exit_status: $status"
exit "$status"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="$ROOT_DIR/experiments/mpc-cggmp24-spike"
OUT_DIR="$CRATE_DIR/pkg"
RUNTIME_DIR="$ROOT_DIR/js/background/wasm/cggmp24"
TARGET_DIR="$CRATE_DIR/target/wasm32-unknown-unknown/release"
WASM_IN="$TARGET_DIR/mpc_cggmp24_spike.wasm"

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build cggmp24 WASM" >&2
  exit 1
fi

if ! rustup target list --installed | grep -qx 'wasm32-unknown-unknown'; then
  echo "Rust target wasm32-unknown-unknown is not installed." >&2
  echo "Run: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "wasm-bindgen CLI is required to generate JS bindings." >&2
  echo "Run: cargo install wasm-bindgen-cli --version 0.2.126" >&2
  exit 1
fi

cargo build \
  --manifest-path "$CRATE_DIR/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

wasm-bindgen "$WASM_IN" \
  --target web \
  --out-dir "$OUT_DIR"

rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
cp "$OUT_DIR"/mpc_cggmp24_spike.js "$RUNTIME_DIR"/
cp "$OUT_DIR"/mpc_cggmp24_spike_bg.wasm "$RUNTIME_DIR"/
cp "$OUT_DIR"/mpc_cggmp24_spike.d.ts "$RUNTIME_DIR"/
cp "$OUT_DIR"/mpc_cggmp24_spike_bg.wasm.d.ts "$RUNTIME_DIR"/

echo "cggmp24 WASM package written to $OUT_DIR"
echo "cggmp24 extension runtime copied to $RUNTIME_DIR"

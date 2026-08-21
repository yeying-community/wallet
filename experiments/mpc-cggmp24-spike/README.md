# cggmp24 MPC Spike

This isolated experiment validates whether `cggmp24` can fit the wallet MPC
engine boundary before wiring it into the browser extension.

Current scope:

- secp256k1 threshold ECDSA signing
- 2-of-2 local simulation
- `round-based` transport simulation
- trusted-dealer shares only, used to validate signing and message-driving shape
- `backend-num-bigint`, avoiding the native `rug`/GMP backend for browser-facing
  feasibility checks

Out of scope for this first spike:

- production DKG
- WASM packaging
- Chrome extension worker integration
- encrypted wallet storage
- coordinator API wiring

Current findings:

- `cggmp24` is the best-fit open-source candidate found so far for a real
  threshold ECDSA engine: MIT/Apache-2.0, secp256k1 support, and a
  `round-based` state-machine API that can map to the existing wallet MPC
  adapter boundary.
- The crate compiles natively and passes `cargo check --target
  wasm32-unknown-unknown` in this isolated experiment when using
  `backend-num-bigint` and `getrandom/js`.
- The local `core2` patch is only to work around the configured Cargo mirror
  resolving a yanked `core2 0.4.0` dependency through `glass_pumpkin`; it is
  not a production dependency decision.
- The machine currently has Homebrew `rustc/cargo` first on `PATH`, while the
  WASM target is installed through rustup. Use the rustup shim for WASM checks:
  `PATH="$HOME/.cargo/bin:$PATH" cargo check --target wasm32-unknown-unknown`.
- Default Paillier/ZK-sized auxiliary data is computationally heavy. The
  end-to-end trusted-dealer signing test is kept as an ignored manual test
  because it ran for more than four minutes locally before being interrupted.
- Smaller RSA/Paillier parameters fail during signing with Paillier encryption
  errors, so the spike should not use undersized parameters to fake a passing
  result.

Run the compile/smoke check:

```sh
cargo test
```

Check browser-target compilation:

```sh
PATH="$HOME/.cargo/bin:$PATH" cargo check --target wasm32-unknown-unknown
```

Run the slow real signing simulation manually:

```sh
cargo test -- --ignored
```

Next integration questions:

- Should auxiliary data be generated out of band and cached per participant
  group before keygen/signing?
- How should `round-based` messages be serialized, encrypted, and delivered
  through the existing node MPC session APIs?
- Can production keygen use `cggmp24::keygen` instead of the `spof`
  trusted-dealer path while meeting wallet UX latency requirements?

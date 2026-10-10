#!/usr/bin/env bash
set -euo pipefail
# Rust 1.91.0 and wasm-bindgen-cli 0.2.129 are pinned with Cargo.lock. The
# generated assets are checked in so ordinary frontend builds need no Rust.
crypto_root=$(cd "$(dirname "$0")/.." && pwd)
crypto_cargo=${COLLABORATION_CARGO:-cargo}
crypto_bindgen=${COLLABORATION_WASM_BINDGEN:-wasm-bindgen}
crypto_target=${CARGO_TARGET_DIR:-"$crypto_root/tmp/collaboration-crypto-build"}
crypto_out="$crypto_root/frontend/src/collaboration/generated"
if ! "$crypto_bindgen" --version | awk '{print $2}' | grep -qx '0.2.129'; then
  echo 'Install wasm-bindgen-cli 0.2.129 before rebuilding collaboration crypto.' >&2
  exit 1
fi
mkdir -p "$crypto_out"
export CARGO_TARGET_DIR="$crypto_target"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$crypto_root=."
if [[ -n "${CARGO_HOME:-}" ]]; then
  export RUSTFLAGS="$RUSTFLAGS --remap-path-prefix=$CARGO_HOME=cargo"
fi
# Run inside the crate so rustup reads its pinned rust-toolchain.toml even when
# this script was called from the repository root.
(cd "$crypto_root/collaboration-crypto" && "$crypto_cargo" build --locked --target wasm32-unknown-unknown --release)
"$crypto_bindgen" "$crypto_target/wasm32-unknown-unknown/release/visual_nerve_collaboration_crypto.wasm" --target web --out-name mls --out-dir "$crypto_out" --no-typescript --remove-name-section --remove-producers-section
# The binding exposes an opaque disposable session; a hand-written narrow .d.ts
# stays reviewable and is checked by TypeScript rather than exporting every ABI.
node "$crypto_root/collaboration-crypto/write-manifest.mjs"

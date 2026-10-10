#!/usr/bin/env bash
set -euo pipefail
# Canonical release assets are built on Linux x86_64. Other hosts may rebuild
# functionally equivalent development assets in an explicit ignored directory.
crypto_root=$(cd "$(dirname "$0")/.." && pwd -P)
crypto_cargo=${COLLABORATION_CARGO:-cargo}
crypto_bindgen=${COLLABORATION_WASM_BINDGEN:-wasm-bindgen}
crypto_target=${CARGO_TARGET_DIR:-"$crypto_root/tmp/collaboration-crypto-build"}
crypto_out="$crypto_root/frontend/src/collaboration/generated"
crypto_mode=release
if [[ $# -eq 2 && "$1" == --development ]]; then
  crypto_mode=development
  # Resolve existing ancestors as well as '..' so a symlink cannot redirect a
  # development build into the canonical tracked directory.
  crypto_out=$(node --input-type=module -e '
    import { existsSync, mkdirSync, realpathSync } from "node:fs";
    import { basename, dirname, join, resolve, sep } from "node:path";
    const temporary = join(realpathSync(process.argv[1]), "tmp");
    mkdirSync(temporary, { recursive: true });
    const safeRoot = realpathSync(temporary);
    let ancestor = resolve(process.argv[2]);
    const suffix = [];
    while (!existsSync(ancestor)) {
      suffix.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
    const output = join(realpathSync(ancestor), ...suffix);
    if (!output.startsWith(safeRoot + sep))
      throw new Error("Development output must be a directory inside this repository tmp/.");
    console.log(output);
  ' "$crypto_root" "$2")
elif [[ $# -ne 0 ]]; then
  echo 'Usage: build.sh [--development /absolute/path/to/repository/tmp/output]' >&2
  exit 2
fi
if [[ "$crypto_mode" == release ]]; then
  if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
    echo 'Canonical collaboration release builds require Linux x86_64. Use --development with an output directory inside repository tmp/ on other hosts.' >&2
    exit 1
  fi
  if ! rustc +1.91.0 --version --verbose | grep -qx 'host: x86_64-unknown-linux-gnu'; then
    echo 'Canonical release builds require the pinned x86_64-unknown-linux-gnu Rust toolchain.' >&2
    exit 1
  fi
  if [[ -z "${CARGO_HOME:-}" ]]; then
    echo 'Set CARGO_HOME explicitly before a canonical release build.' >&2
    exit 1
  fi
  if [[ -n "${RUSTFLAGS:-}${CARGO_ENCODED_RUSTFLAGS:-}${CARGO_BUILD_RUSTFLAGS:-}${CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS:-}${RUSTC:-}${RUSTC_WRAPPER:-}${RUSTC_WORKSPACE_WRAPPER:-}" ]]; then
    echo 'Canonical release builds do not accept inherited Rust flags or compiler wrappers.' >&2
    exit 1
  fi
fi
# The toolchain selector prevents an ambient default Cargo/Rust version from
# overriding the locked release compiler; no credential environment is read.
if ! (cd "$crypto_root/collaboration-crypto" && "$crypto_cargo" +1.91.0 --version) | grep -q '^cargo 1\.91\.0 '; then
  echo 'Install the pinned Rust/Cargo 1.91.0 toolchain before rebuilding.' >&2
  exit 1
fi
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
(cd "$crypto_root/collaboration-crypto" && "$crypto_cargo" +1.91.0 build --locked --target wasm32-unknown-unknown --release)
"$crypto_bindgen" "$crypto_target/wasm32-unknown-unknown/release/visual_nerve_collaboration_crypto.wasm" --target web --out-name mls --out-dir "$crypto_out" --no-typescript --remove-name-section --remove-producers-section
# The binding exposes an opaque disposable session; a hand-written narrow .d.ts
# stays reviewable and is checked by TypeScript rather than exporting every ABI.
node "$crypto_root/collaboration-crypto/write-manifest.mjs" "$crypto_out" "$crypto_mode"

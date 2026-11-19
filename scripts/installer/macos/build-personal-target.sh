#!/usr/bin/env bash
# 构建自用 DMG 的单架构输入。Apple Silicon 构建同时产出用于验证更新的命令行程序。
set -euo pipefail

target="${1:-}"
targets=(--package codex-plus-manager --bin codex-plus-plus --bin codex-plus-legacy-shim)
case "$target" in
  aarch64-apple-darwin)
    targets+=(--package codex-plus-core --example personal-update-check)
    ;;
  x86_64-apple-darwin) ;;
  *)
    echo "Usage: bash $0 {aarch64-apple-darwin|x86_64-apple-darwin}" >&2
    exit 2
    ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
exec cargo build --locked --release --target "$target" "${targets[@]}"

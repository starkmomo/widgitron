#!/bin/bash
set -euo pipefail
repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository"
VITE_TEST_BUILD=true pnpm tauri build --config src-tauri/tauri.test.conf.json --bundles app
printf 'Test app: %s/src-tauri/target/release/bundle/macos/Widgitron 测试版.app\n' "$repository"

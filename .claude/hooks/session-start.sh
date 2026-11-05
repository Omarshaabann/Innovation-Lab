#!/bin/bash
set -euo pipefail

# Remote (cloud) sessions only
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

OPENCODE_BIN="$HOME/.opencode/bin"

# Install OpenCode only if missing (idempotent)
if [ ! -x "$OPENCODE_BIN/opencode" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL https://opencode.ai/v2/install -o "$tmp/install.sh"
  bash "$tmp/install.sh" --no-modify-path
  rm -rf "$tmp"
fi

# Make opencode available on PATH for the whole session
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$OPENCODE_BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

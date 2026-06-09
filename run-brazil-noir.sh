#!/bin/bash
# Brazil Noir Pipeline — Script de execução
# Rodado pelo launchd às 13:00 (alternando com Codex Mental às 20:00)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/logs/brazil-noir-$(date +%Y-%m-%d_%H-%M-%S).log"
mkdir -p "$SCRIPT_DIR/logs"

echo "🕵️ Brazil Noir Pipeline starting at $(date)" | tee "$LOG_FILE"

/usr/local/bin/node pipeline/brazil-noir/index.js 2>&1 | tee -a "$LOG_FILE"

echo "✅ Brazil Noir Pipeline finished at $(date)" | tee -a "$LOG_FILE"

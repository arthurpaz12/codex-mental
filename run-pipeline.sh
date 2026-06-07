#!/bin/bash
#
# Wrapper de execução do pipeline Codex Mental — usado pelo agendador (launchd).
# Garante PATH correto do Node (Homebrew) e loga a saída com timestamp.

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_DIR="/Users/arthurpaz/Documents/GitHub/codex-mental"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/run-$TIMESTAMP.log"

cd "$PROJECT_DIR" || exit 1

echo "🚀 Iniciando pipeline em $(date)" >> "$LOG_FILE"
npm run pipeline >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
echo "🏁 Pipeline finalizado com código $EXIT_CODE em $(date)" >> "$LOG_FILE"

# Mantém só os últimos 30 logs
ls -t "$LOG_DIR"/run-*.log | tail -n +31 | xargs rm -f 2>/dev/null

exit $EXIT_CODE

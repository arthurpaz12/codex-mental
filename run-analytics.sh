#!/bin/bash
#
# Atualiza métricas dos vídeos publicados (views/likes/comments) e
# publica o data.json atualizado no dashboard (Vercel).

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_DIR="/Users/arthurpaz/Documents/GitHub/codex-mental"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/analytics-$(date +%Y-%m-%d).log"

cd "$PROJECT_DIR" || exit 1

echo "📈 Atualizando analytics em $(date)" >> "$LOG_FILE"
node pipeline/10-analytics.js >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

# Publica data.json/insights.json atualizados no dashboard
if [ $EXIT_CODE -eq 0 ]; then
  if ! git diff --quiet dashboard/data.json dashboard/insights.json 2>/dev/null; then
    git add dashboard/data.json dashboard/insights.json 2>/dev/null
    git commit -m "Atualiza métricas do dashboard (analytics)" >> "$LOG_FILE" 2>&1
    git push >> "$LOG_FILE" 2>&1
  fi
fi

echo "🏁 Analytics finalizado com código $EXIT_CODE em $(date)" >> "$LOG_FILE"

# Mantém só os últimos 30 logs
ls -t "$LOG_DIR"/analytics-*.log | tail -n +31 | xargs rm -f 2>/dev/null

exit $EXIT_CODE

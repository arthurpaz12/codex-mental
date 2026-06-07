/**
 * Módulo 9: Dashboard — Atualiza os dados do painel (Vercel)
 *
 * Mantém um histórico rolante (últimas N execuções) em
 * dashboard/data.json — consumido pela página estática em
 * dashboard/index.html, hospedada na Vercel.
 *
 * Como a Vercel serve o dashboard como site estático, o arquivo
 * data.json precisa ser commitado/enviado ao repo para refletir
 * no painel publicado (o pipeline já cuida de atualizar o arquivo;
 * o commit/push pode ser feito manualmente ou via automação futura).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, "../dashboard");
const DATA_PATH = join(DASHBOARD_DIR, "data.json");

const MAX_RUNS = 30;

function loadData() {
  if (!existsSync(DATA_PATH)) {
    return { lastUpdated: null, settings: { estimatedRevenuePerVideo: 5, currency: "BRL" }, runs: [] };
  }
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return { lastUpdated: null, settings: { estimatedRevenuePerVideo: 5, currency: "BRL" }, runs: [] };
  }
}

/**
 * Resume o estado de uma execução do pipeline em um registro enxuto
 * para o dashboard (evita carregar o JSON inteiro do roteiro/etc).
 */
function summarizeRun(state) {
  return {
    runId: state.runId,
    startedAt: state.startedAt,
    completedAt: state.completedAt || null,
    status: state.error ? "error" : "ok",
    error: state.error || null,
    topic: state.topic?.topic || null,
    category: state.topic?.category || null,
    viralScore: state.topic?.viralScore ?? null,
    publish: (state.publish || []).map((p) => ({
      platform: p.platform,
      url: p.url,
      publishId: p.publishId || null,
    })),
    sound: state.sound
      ? { category: state.sound.category, sound: state.sound.sound }
      : null,
  };
}

/**
 * Export principal — adiciona/atualiza o registro da execução atual
 * no histórico rolante e persiste em dashboard/data.json
 */
export async function updateDashboard(state) {
  console.log("📊 [Dashboard] Atualizando dados do painel...");

  mkdirSync(DASHBOARD_DIR, { recursive: true });
  const data = loadData();

  const entry = summarizeRun(state);

  // Substitui se já existir um registro para o mesmo runId (reexecução), senão adiciona
  // — preserva métricas (stats) já buscadas pelo módulo de analytics, se existirem
  const idx = data.runs.findIndex((r) => r.runId === entry.runId);
  if (idx >= 0) {
    if (data.runs[idx].stats) entry.stats = data.runs[idx].stats;
    if (data.runs[idx].statsUpdatedAt) entry.statsUpdatedAt = data.runs[idx].statsUpdatedAt;
    data.runs[idx] = entry;
  } else {
    data.runs.push(entry);
  }

  // Mantém só as últimas MAX_RUNS execuções
  if (data.runs.length > MAX_RUNS) {
    data.runs = data.runs.slice(data.runs.length - MAX_RUNS);
  }

  data.lastUpdated = new Date().toISOString();

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log(`   → Histórico: ${data.runs.length} execuções registradas`);
  console.log(`   → Arquivo: ${DATA_PATH}`);
  console.log("✅ [Dashboard] Dados atualizados — lembre-se de commitar/enviar para refletir no painel publicado");

  return { dataPath: DATA_PATH, totalRuns: data.runs.length };
}

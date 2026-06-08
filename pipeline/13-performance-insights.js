/**
 * Módulo 13: Insights de Performance — analisa os dados reais já coletados
 * (dashboard/data.json) e aponta padrões do que está funcionando melhor:
 * categorias/temas com mais engajamento, plataformas mais fortes, e qual
 * combinação de fatores tende a gerar mais visualizações.
 *
 * Não inventa números nem faz suposições mágicas: cruza o que já temos
 * (views, likes, comentários, categoria, viralScore, plataforma) e organiza
 * isso em um relatório acionável — para orientar próximos roteiros, escolha
 * de temas e ajustes de metadados/SEO.
 *
 * Uso:
 *   node pipeline/13-performance-insights.js
 *   npm run insights
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../dashboard/data.json");
const OUTPUT_PATH = join(__dirname, "../dashboard/insights.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregateRunStats(run) {
  const yt = run.stats?.youtube || {};
  const sh = run.stats?.youtube_shorts || {};
  const tk = run.stats?.tiktok || {};
  const views = (yt.views || 0) + (sh.views || 0) + (tk.views || 0);
  const likes = (yt.likes || 0) + (sh.likes || 0) + (tk.likes || 0);
  const comments = (yt.comments || 0) + (sh.comments || 0) + (tk.comments || 0);
  const engagement = views > 0 ? ((likes + comments) / views) * 100 : 0;
  return { views, likes, comments, engagement, byPlatform: { youtube: yt, youtube_shorts: sh, tiktok: tk } };
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function rankBy(groups, metric) {
  return Object.entries(groups)
    .map(([key, items]) => {
      const views = items.map((i) => i.views);
      const eng = items.map((i) => i.engagement);
      return {
        key,
        videos: items.length,
        totalViews: views.reduce((a, b) => a + b, 0),
        avgViews: round(avg(views), 1),
        avgEngagement: round(avg(eng), 2),
      };
    })
    .sort((a, b) => b[metric] - a[metric]);
}

function groupBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item);
    if (key === null || key === undefined) continue;
    out[key] = out[key] || [];
    out[key].push(item);
  }
  return out;
}

function hourLabel(h) {
  return `${String(h).padStart(2, "0")}h`;
}
function weekdayLabel(d) {
  return ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][d];
}

// ---------------------------------------------------------------------------
// Análise principal
// ---------------------------------------------------------------------------

export async function generateInsights() {
  console.log("🔎 [Insights] Analisando performance dos vídeos publicados...");

  if (!existsSync(DATA_PATH)) {
    console.warn("   ⚠️  dashboard/data.json não encontrado — rode o pipeline primeiro");
    return null;
  }

  const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const runs = data.runs || [];

  // Apenas execuções publicadas e com métricas coletadas entram na análise
  const items = runs
    .filter((r) => r.status === "ok" && (r.publish || []).length > 0)
    .map((r) => {
      const agg = aggregateRunStats(r);
      const publishedAt = r.completedAt || r.startedAt;
      const date = publishedAt ? new Date(publishedAt) : null;
      return {
        runId: r.runId,
        topic: r.topic,
        category: r.category || "sem categoria",
        viralScore: r.viralScore ?? null,
        platforms: (r.publish || []).map((p) => p.platform),
        publishedAt,
        hour: date ? date.getUTCHours() : null,
        weekday: date ? date.getUTCDay() : null,
        ...agg,
      };
    })
    .filter((i) => i.views > 0 || i.likes > 0); // só entra quem já tem alguma métrica

  if (items.length === 0) {
    console.log("   ℹ️  Ainda não há dados suficientes (vídeos publicados com métricas) para gerar insights.");
    console.log("       Assim que o pipeline publicar mais vídeos e o módulo de analytics coletar métricas, rode novamente.");
    const empty = { generatedAt: new Date().toISOString(), sampleSize: 0, message: "Dados insuficientes ainda — volte a rodar quando houver mais vídeos publicados com métricas." };
    writeFileSync(OUTPUT_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }

  // ---- Rankings por dimensão -----------------------------------------------
  const byCategory = rankBy(groupBy(items, (i) => i.category), "avgViews");
  const byPlatform = rankBy(
    groupBy(
      items.flatMap((i) =>
        i.platforms
          .filter((p) => i.byPlatform[p] && (i.byPlatform[p].views || i.byPlatform[p].likes))
          .map((p) => {
            const s = i.byPlatform[p];
            const views = s.views || 0;
            const likes = s.likes || 0;
            const comments = s.comments || 0;
            return { views, engagement: views > 0 ? ((likes + comments) / views) * 100 : 0, _platform: p };
          })
      ),
      (i) => i._platform
    ),
    "avgViews"
  );
  const byHour = rankBy(groupBy(items.filter((i) => i.hour !== null), (i) => hourLabel(i.hour)), "avgEngagement");
  const byWeekday = rankBy(groupBy(items.filter((i) => i.weekday !== null), (i) => weekdayLabel(i.weekday)), "avgEngagement");

  // ---- Top vídeos -----------------------------------------------------------
  const topByViews = [...items].sort((a, b) => b.views - a.views).slice(0, 5).map((i) => ({
    topic: i.topic, category: i.category, views: i.views, engagement: round(i.engagement, 2), platforms: i.platforms,
  }));
  const topByEngagement = [...items].sort((a, b) => b.engagement - a.engagement).slice(0, 5).map((i) => ({
    topic: i.topic, category: i.category, views: i.views, engagement: round(i.engagement, 2), platforms: i.platforms,
  }));

  // ---- Correlação simples entre viralScore (estimativa de IA) e resultado real
  const withScore = items.filter((i) => i.viralScore !== null);
  const scoreCorrelation = withScore.length >= 2
    ? round(pearson(withScore.map((i) => i.viralScore), withScore.map((i) => i.views)), 2)
    : null;

  // ---- Recomendações textuais -----------------------------------------------
  const recommendations = [];
  if (byCategory.length > 1) {
    recommendations.push(
      `A categoria "${byCategory[0].key}" tem a melhor média de views (${fmtN(byCategory[0].avgViews)}) — vale priorizar temas parecidos.`
    );
  }
  if (byPlatform.length > 1) {
    recommendations.push(
      `"${byPlatform[0].key}" é a plataforma com melhor desempenho médio — considere adaptar mais conteúdo pro formato dela.`
    );
  }
  if (byHour.length > 1) {
    recommendations.push(
      `Publicações por volta das ${byHour[0].key} (UTC) tiveram o maior engajamento médio — pode ser um bom horário pra concentrar lançamentos.`
    );
  }
  if (scoreCorrelation !== null) {
    if (scoreCorrelation > 0.4) {
      recommendations.push(`O "viralScore" estimado pela IA está se mostrando um bom previsor de resultado real (correlação ${scoreCorrelation}) — confie nele ao escolher temas.`);
    } else if (scoreCorrelation < -0.2) {
      recommendations.push(`O "viralScore" estimado pela IA está com correlação negativa (${scoreCorrelation}) com os resultados reais — vale revisar os critérios usados pra calculá-lo.`);
    } else {
      recommendations.push(`Ainda não há correlação clara entre o "viralScore" da IA e os resultados reais (${scoreCorrelation}) — continue coletando dados pra confirmar o padrão.`);
    }
  }
  if (items.length < 5) {
    recommendations.push("Amostra ainda pequena — esses padrões vão ficar mais confiáveis conforme mais vídeos forem publicados e medidos.");
  }

  const insights = {
    generatedAt: new Date().toISOString(),
    sampleSize: items.length,
    topByViews,
    topByEngagement,
    byCategory,
    byPlatform,
    byHourUTC: byHour,
    byWeekday,
    viralScoreCorrelation: scoreCorrelation,
    recommendations,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(insights, null, 2));

  // ---- Relatório no console --------------------------------------------------
  console.log(`\n📊 Amostra analisada: ${items.length} vídeo(s) publicado(s) com métricas\n`);

  console.log("🏆 Top por visualizações:");
  topByViews.forEach((v, idx) => console.log(`   ${idx + 1}. ${v.topic} — ${fmtN(v.views)} views (${v.category}, ${v.platforms.join("/")})`));

  console.log("\n💬 Top por engajamento:");
  topByEngagement.forEach((v, idx) => console.log(`   ${idx + 1}. ${v.topic} — ${v.engagement}% (${fmtN(v.views)} views)`));

  console.log("\n📂 Desempenho por categoria:");
  byCategory.forEach((c) => console.log(`   • ${c.key}: ${c.videos} vídeo(s), média de ${fmtN(c.avgViews)} views, ${c.avgEngagement}% engajamento`));

  console.log("\n📡 Desempenho por plataforma:");
  byPlatform.forEach((p) => console.log(`   • ${p.key}: ${p.videos} vídeo(s), média de ${fmtN(p.avgViews)} views, ${p.avgEngagement}% engajamento`));

  if (scoreCorrelation !== null) {
    console.log(`\n🎯 Correlação viralScore (IA) × views reais: ${scoreCorrelation} (-1 a 1)`);
  }

  console.log("\n💡 Recomendações:");
  recommendations.forEach((r) => console.log(`   → ${r}`));

  console.log(`\n✅ [Insights] Relatório salvo em dashboard/insights.json`);

  return insights;
}

function fmtN(n) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));
}

// Correlação de Pearson simples (sem dependências externas)
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/13-performance-insights.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateInsights().catch((e) => {
    console.error("❌ Erro ao gerar insights:", e.message);
    process.exit(1);
  });
}

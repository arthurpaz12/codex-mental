/**
 * Módulo 12: Estimativa de Ganhos — calcula uma projeção de receita com base
 * nos números REAIS que já estão no dashboard/data.json (views do YouTube/
 * TikTok coletados pelo módulo 10, e vendas/faturamento reais da Hotmart
 * coletados pelo módulo 11).
 *
 * Não inventa números: usa o que já foi coletado e aplica premissas de
 * mercado (RPM de anúncios, taxa de conversão de afiliado) — todas
 * configuráveis no topo do arquivo — pra estimar o que ainda não dá pra medir
 * diretamente (ex: quanto o canal pode estar rendendo de AdSense antes de
 * bater o threshold de monetização, ou o potencial de vendas via Hotmart
 * em diferentes cenários de crescimento de audiência).
 *
 * Uso:
 *   node pipeline/12-revenue-estimate.js
 *   npm run revenue
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../dashboard/data.json");

// ---------------------------------------------------------------------------
// Premissas de mercado (ajuste aqui conforme a realidade do canal evoluir)
// ---------------------------------------------------------------------------

// RPM = Receita por Mil views (R$). Faixas conservador/moderado/otimista —
// nicho "psicologia/curiosidades" tende a ficar na faixa média de CPM.
const RPM_SCENARIOS = {
  conservador: 4,
  moderado: 8,
  otimista: 14,
};

// Taxa de conversão de quem assiste pra quem compra via link de afiliado
// (Hotmart). 0.05% é uma taxa baixa/realista pra início; 0.2% já é um
// funil bem otimizado.
const CONVERSION_SCENARIOS = {
  conservador: 0.0005,
  moderado: 0.001,
  otimista: 0.002,
};

const TICKET_MEDIO = 67; // R$ — ajuste pro valor real do produto promovido

// Custo aproximado de geração de cada vídeo (Claude + ElevenLabs + etc)
const CUSTO_POR_VIDEO = 3.5; // R$

// Canais do projeto no YouTube (pra acompanhar inscritos vs meta de monetização)
const YOUTUBE_CHANNELS = {
  "codex-mental": { name: "Codex Mental", id: "UC5V9cXbAkVglRcSko5GtLiQ" },
  "brazil-noir":  { name: "Brazil Noir",  id: "UCdVudlJFf_iAz47AtqrJ90w" },
};

// Metas dos programas de monetização
const GOALS = {
  youtube: { subs: 1000, shortsViews90d: 10_000_000 },
  tiktok:  { followers: 10_000, views30d: 100_000 },
};

const fmtBRL = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (n) => n.toLocaleString("pt-BR");

async function fetchChannelStats() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return {};
  const ids = Object.values(YOUTUBE_CHANNELS).map((c) => c.id).join(",");
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ids}&key=${apiKey}`,
      { headers: { Referer: "https://codex-mental.vercel.app/" } }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const out = {};
    for (const item of data.items || []) {
      const key = Object.keys(YOUTUBE_CHANNELS).find((k) => YOUTUBE_CHANNELS[k].id === item.id);
      if (key) out[key] = {
        subs: parseInt(item.statistics.subscriberCount || "0", 10),
        totalViews: parseInt(item.statistics.viewCount || "0", 10),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function loadData() {
  if (!existsSync(DATA_PATH)) {
    console.error("❌ dashboard/data.json não encontrado — rode os módulos 9 (publish) e 10 (analytics) primeiro.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(DATA_PATH, "utf-8"));
}

function sumViews(runs) {
  let youtube = 0, tiktok = 0, videosPublicados = 0;
  for (const run of runs) {
    const stats = run.stats || {};
    if (stats.youtube?.views) youtube += stats.youtube.views;
    if (stats.youtube_shorts?.views) youtube += stats.youtube_shorts.views;
    if (stats.tiktok?.views) tiktok += stats.tiktok.views;
    if ((run.publish || []).length > 0) videosPublicados++;
  }
  return { youtube, tiktok, total: youtube + tiktok, videosPublicados };
}

function projectScenario(monthlyViews, scenarioKey) {
  const rpm = RPM_SCENARIOS[scenarioKey];
  const conv = CONVERSION_SCENARIOS[scenarioKey];

  const adRevenue = (monthlyViews / 1000) * rpm;
  const sales = monthlyViews * conv;
  const affiliateRevenue = sales * TICKET_MEDIO;

  return { rpm, conv, adRevenue, sales, affiliateRevenue, total: adRevenue + affiliateRevenue };
}

export async function estimateRevenue() {
  const data = loadData();
  const runs = data.runs || [];
  const { youtube, tiktok, total, videosPublicados } = sumViews(runs);
  const hotmart = data.hotmart || {};
  const channelStats = await fetchChannelStats();

  console.log("\n💰 ESTIMATIVA DE GANHOS — Codex Mental\n");
  console.log("📊 Números reais coletados até agora:");
  console.log(`   → Vídeos publicados: ${fmtNum(videosPublicados)}`);
  console.log(`   → Views YouTube (acumulado): ${fmtNum(youtube)}`);
  console.log(`   → Views TikTok (acumulado):  ${fmtNum(tiktok)}`);
  console.log(`   → Views totais (acumulado):  ${fmtNum(total)}`);
  console.log(`   → Faturamento Hotmart (últimos 30 dias): ${fmtBRL(hotmart.revenueLast30Days || 0)} (${fmtNum(hotmart.salesLast30Days || 0)} vendas)`);

  const custoTotal = videosPublicados * CUSTO_POR_VIDEO;
  console.log(`   → Custo estimado de geração (${fmtNum(videosPublicados)} vídeos × ${fmtBRL(CUSTO_POR_VIDEO)}): ${fmtBRL(custoTotal)}`);

  if (total === 0) {
    console.log("\n   ℹ️  Ainda não há views registradas — rode `npm run analytics` após publicar vídeos");
    console.log("       pra coletar números reais e refinar esta estimativa.\n");
  }

  // Projeções por plataforma, assumindo o volume de views ATUAL como "por mês"
  const ytMonthly = youtube > 0 ? youtube : 0;
  const tkMonthly = tiktok > 0 ? tiktok : 0;

  for (const [label, views] of [["YouTube", ytMonthly], ["TikTok", tkMonthly]]) {
    console.log(`\n📈 Projeção mensal — ${label} (~${fmtNum(views)} views/mês):\n`);
    console.log("   Cenário      | RPM (R$/mil) | Conv. afiliado | Receita anúncios | Receita afiliado | TOTAL/mês");
    console.log("   " + "-".repeat(100));
    for (const key of ["conservador", "moderado", "otimista"]) {
      const p = projectScenario(views, key);
      console.log(
        `   ${key.padEnd(12)} | ${fmtBRL(p.rpm).padStart(12)} | ${(p.conv * 100).toFixed(2).padStart(13)}% | ` +
        `${fmtBRL(p.adRevenue).padStart(16)} | ${fmtBRL(p.affiliateRevenue).padStart(16)} | ${fmtBRL(p.total).padStart(12)}`
      );
    }
  }

  // Metas de monetização
  console.log("\n🎯 Metas de monetização:\n");
  for (const [key, ch] of Object.entries(YOUTUBE_CHANNELS)) {
    const st = channelStats[key] || { subs: 0, totalViews: 0 };
    const pct = ((st.subs / GOALS.youtube.subs) * 100).toFixed(1);
    console.log(`   ${ch.name} (YouTube): ${fmtNum(st.subs)}/${fmtNum(GOALS.youtube.subs)} inscritos (${pct}%) | ${fmtNum(st.totalViews)} views totais`);
  }
  console.log(`   TikTok (Creator Rewards): ${fmtNum(GOALS.tiktok.followers)} seguidores + ${fmtNum(GOALS.tiktok.views30d)} views/30d necessários`);

  console.log(`\n   💡 Lucro líquido estimado = receita projetada − custo de geração (${fmtBRL(CUSTO_POR_VIDEO)}/vídeo).`);
  console.log("   ⚠️  Estimativa especulativa baseada em médias de mercado — não é garantia de resultado.\n");

  const mkScenarios = (views) => Object.fromEntries(
    ["conservador", "moderado", "otimista"].map((k) => [k, projectScenario(views, k)])
  );

  const result = {
    realStats: { youtube, tiktok, total, videosPublicados, hotmart },
    custoTotal,
    baseMonthlyViews: total,
    generatedAt: new Date().toISOString(),
    // Mantém `scenarios` (total) por compat. com o painel antigo + novo formato por plataforma
    scenarios: mkScenarios(total),
    perPlatform: {
      youtube: { monthlyViews: ytMonthly, scenarios: mkScenarios(ytMonthly) },
      tiktok:  { monthlyViews: tkMonthly, scenarios: mkScenarios(tkMonthly) },
    },
    monetizationGoals: {
      youtube: Object.fromEntries(
        Object.entries(YOUTUBE_CHANNELS).map(([key, ch]) => [key, {
          name: ch.name,
          subs: channelStats[key]?.subs ?? 0,
          subsGoal: GOALS.youtube.subs,
          totalViews: channelStats[key]?.totalViews ?? 0,
          shortsViewsGoal90d: GOALS.youtube.shortsViews90d,
        }])
      ),
      tiktok: {
        followersGoal: GOALS.tiktok.followers,
        viewsGoal30d: GOALS.tiktok.views30d,
        views: tiktok,
      },
    },
  };

  // Grava no dashboard/data.json pra aparecer direto no painel (seção
  // "🔮 Projeção de receita"), sem precisar de nenhuma ferramenta extra.
  try {
    data.revenueProjection = result;
    data.lastUpdated = new Date().toISOString();
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    console.log("   📊 Projeção salva em dashboard/data.json — já aparece no painel (seção '🔮 Projeção de receita').\n");
  } catch (e) {
    console.warn(`   ⚠️  Não foi possível salvar a projeção no dashboard: ${e.message}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/12-revenue-estimate.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  estimateRevenue();
}

/**
 * Módulo 10: Analytics — Busca métricas dos vídeos publicados
 *
 * Para cada vídeo publicado (YouTube / TikTok) registrado no histórico
 * do dashboard, busca views, likes e comentários via API oficial e
 * atualiza dashboard/data.json com os números mais recentes.
 *
 * YouTube: usa a Data API v3 com YOUTUBE_API_KEY (somente leitura, sem OAuth)
 * TikTok: tenta via Display/Query API com TIKTOK_ACCESS_TOKEN — métricas só
 *         ficam disponíveis se o app tiver o escopo `video.list` aprovado;
 *         caso não tenha, marca como indisponível (sem quebrar o pipeline)
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { estimateRevenue } from "./12-revenue-estimate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../dashboard/data.json");

// ---------------------------------------------------------------------------
// YouTube — Data API v3 (chave simples, somente leitura)
// ---------------------------------------------------------------------------

async function fetchYouTubeStats(videoIds) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || videoIds.length === 0) return {};

  const stats = {};
  // A API aceita até 50 IDs por requisição
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.join(",")}&key=${apiKey}`;
    try {
      // A chave da API tem restrição de HTTP referrer (configurada pro
      // dashboard na Vercel) — em chamadas server-side o referer vai vazio
      // e o Google bloqueia (403), então enviamos o referer permitido.
      const res = await fetch(url, { headers: { Referer: "https://codex-mental.vercel.app/" } });
      if (!res.ok) {
        console.warn(`   ⚠️  YouTube stats erro ${res.status}`);
        continue;
      }
      const data = await res.json();
      for (const item of data.items || []) {
        stats[item.id] = {
          views: parseInt(item.statistics.viewCount || "0", 10),
          likes: parseInt(item.statistics.likeCount || "0", 10),
          comments: parseInt(item.statistics.commentCount || "0", 10),
        };
      }
    } catch (e) {
      console.warn(`   ⚠️  YouTube stats falhou: ${e.message}`);
    }
  }
  return stats;
}

function extractYouTubeVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:shorts\/|watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// TikTok — tentativa best-effort (requer escopo video.list aprovado)
// ---------------------------------------------------------------------------

async function fetchTikTokStats(publishIds) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token || publishIds.length === 0) return {};

  const stats = {};
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,view_count,like_count,comment_count,share_count", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: 20 }),
    });

    if (!res.ok) {
      console.warn(`   ⚠️  TikTok stats indisponível (${res.status}) — escopo video.list provavelmente não aprovado ainda`);
      return {};
    }

    const data = await res.json();
    for (const v of data?.data?.videos || []) {
      stats[v.id] = {
        views: v.view_count || 0,
        likes: v.like_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0,
      };
    }
  } catch (e) {
    console.warn(`   ⚠️  TikTok stats falhou: ${e.message}`);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Export principal — atualiza dashboard/data.json com as métricas atuais
// ---------------------------------------------------------------------------

export async function refreshAnalytics() {
  console.log("📈 [Analytics] Buscando métricas dos vídeos publicados...");

  if (!existsSync(DATA_PATH)) {
    console.warn("   ⚠️  dashboard/data.json não encontrado — rode o módulo 9 primeiro");
    return null;
  }

  const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  const runs = data.runs || [];

  // Coleta IDs de vídeos do histórico — YouTube "tradicional", YouTube Shorts
  // e TikTok são tratados como plataformas distintas pra métricas separadas
  const ytIdsByRun = {};
  const ytShortsIdsByRun = {};
  const ytIds = [];
  const tkIdsByRun = {};
  const tkIds = [];

  for (const run of runs) {
    for (const p of run.publish || []) {
      if (p.platform === "youtube") {
        const id = extractYouTubeVideoId(p.url);
        if (id) {
          ytIdsByRun[run.runId] = id;
          ytIds.push(id);
        }
      }
      if (p.platform === "youtube_shorts") {
        const id = extractYouTubeVideoId(p.url);
        if (id) {
          ytShortsIdsByRun[run.runId] = id;
          ytIds.push(id);
        }
      }
      if (p.platform === "tiktok" && p.publishId) {
        tkIdsByRun[run.runId] = p.publishId;
        tkIds.push(p.publishId);
      }
    }
  }

  const [ytStats, tkStats] = await Promise.all([
    fetchYouTubeStats(ytIds),
    fetchTikTokStats(tkIds),
  ]);

  let updated = 0;
  for (const run of runs) {
    const ytId = ytIdsByRun[run.runId];
    const ytShortsId = ytShortsIdsByRun[run.runId];
    const tkId = tkIdsByRun[run.runId];

    const newStats = {};
    if (ytId && ytStats[ytId]) newStats.youtube = ytStats[ytId];
    if (ytShortsId && ytStats[ytShortsId]) newStats.youtube_shorts = ytStats[ytShortsId];
    if (tkId && tkStats[tkId]) newStats.tiktok = tkStats[tkId];

    if (Object.keys(newStats).length > 0) {
      run.stats = { ...(run.stats || {}), ...newStats };
      run.statsUpdatedAt = new Date().toISOString();
      updated++;
    }
  }

  data.lastUpdated = new Date().toISOString();
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  console.log(`   → ${Object.keys(ytStats).length} vídeo(s) do YouTube/Shorts com métricas atualizadas`);
  console.log(`   → ${Object.keys(tkStats).length} vídeo(s) do TikTok com métricas atualizadas`);
  console.log(`✅ [Analytics] ${updated} execuções atualizadas no dashboard`);

  return { youtubeUpdated: Object.keys(ytStats).length, tiktokUpdated: Object.keys(tkStats).length, runsUpdated: updated };
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/10-analytics.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refreshAnalytics()
    .then((r) => {
      console.log("\n📦 Resultado:", JSON.stringify(r, null, 2));
      // Recalcula a projeção de receita com os números recém-atualizados —
      // assim o cron de analytics (que roda mais vezes que o pipeline
      // completo) também mantém a seção "🔮 Projeção de receita" fresca.
      try {
        estimateRevenue();
      } catch (e) {
        console.warn(`   ⚠️  Falha ao recalcular projeção de receita: ${e.message}`);
      }
    })
    .catch((e) => {
      console.error("❌ Erro no analytics:", e.message);
      process.exit(1);
    });
}

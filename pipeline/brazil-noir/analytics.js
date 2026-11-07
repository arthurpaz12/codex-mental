/**
 * Brazil Noir — coletor da dashboard v2 (dashboard/brazil-noir/)
 *
 * Busca o que estiver ligado e grava dashboard/brazil-noir/data.json:
 *
 *   YouTube público   YOUTUBE_API_KEY                         inscritos, views, todos os uploads
 *   YouTube Analytics BN_YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN retenção, horas assistidas, inscritos
 *                     (token com escopo yt-analytics.readonly) ganhos por vídeo, série diária
 *   TikTok            BN_TIKTOK_ACCESS_TOKEN (+ REFRESH_TOKEN,  seguidores, views/likes/coment./
 *                     TIKTOK_CLIENT_KEY/SECRET) escopos        compartilhamentos por vídeo
 *                     user.info.stats + video.list
 *   Instagram Reels   BN_IG_USER_ID + BN_IG_ACCESS_TOKEN       seguidores, plays/likes por Reel
 *
 * Fonte sem credencial é pulada sem quebrar. O que a API não dá (retenção do
 * TikTok, gastos, ganchos) vem de manual.json e spend.json, que a própria
 * página lê — não precisa rodar este script depois de editá-los.
 *
 * Uso:  node pipeline/brazil-noir/analytics.js
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_PATH = join(ROOT, "dashboard/brazil-noir/data.json");
const V1_DATA_PATH = join(ROOT, "dashboard/data.json");
const ENV_PATH = join(ROOT, ".env");

const CHANNEL = {
  name: "Brazil Noir",
  youtube: { handle: "ytBrazilNoir", url: "https://www.youtube.com/@ytBrazilNoir" },
  tiktok: { handle: "brazilnoir", url: "https://www.tiktok.com/@brazilnoir" },
  instagram: { handle: null, url: null },
};

// A chave do YouTube tem restrição de HTTP referrer (dashboard na Vercel);
// chamadas do servidor precisam mandar o referer permitido.
const YT_REFERER = "https://codex-mental.vercel.app/";
const SHORT_MAX_SEC = 180;
const LONGFORM_ERA = "2026-08-01";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const int = (v) => (v == null ? null : parseInt(v, 10) || 0);

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function updateEnvVar(key, value) {
  if (!existsSync(ENV_PATH)) return;
  let content = readFileSync(ENV_PATH, "utf-8");
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content) ? content.replace(re, `${key}=${value}`) : content.trimEnd() + `\n${key}=${value}\n`;
  writeFileSync(ENV_PATH, content);
}

function isoDurationToSec(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

// "The Champinha Case: A teenage killer..." -> "Champinha"
function caseFromTopic(topic) {
  if (!topic) return null;
  const head = topic.split(":")[0].trim();
  return head.replace(/^The\s+/i, "").replace(/\s+Case$/i, "").trim() || null;
}

// ---------------------------------------------------------------------------
// YouTube — Data API v3 (chave simples)
// ---------------------------------------------------------------------------

async function ytGet(path, params) {
  const qs = new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, { headers: { Referer: YT_REFERER } });
  if (!res.ok) throw new Error(`YouTube ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function collectYouTube(legacy) {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log("   ⏭️  YouTube: sem YOUTUBE_API_KEY — pulando");
    return null;
  }
  const ch = (await ytGet("channels", { part: "snippet,statistics,contentDetails", forHandle: CHANNEL.youtube.handle })).items?.[0];
  if (!ch) throw new Error(`canal @${CHANNEL.youtube.handle} não encontrado`);

  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const ids = [];
  let pageToken;
  do {
    const pl = await ytGet("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 50, ...(pageToken && { pageToken }) });
    ids.push(...pl.items.map((i) => i.contentDetails.videoId));
    pageToken = pl.nextPageToken;
  } while (pageToken && ids.length < 500);

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await ytGet("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(",") });
    for (const v of batch.items) {
      const durationSec = isoDurationToSec(v.contentDetails.duration);
      const title = v.snippet.title;
      // Vertical ≤ 3 min = Short. A API não diz a proporção, então usamos o
      // #Shorts do título, o registro da v1 (youtube_shorts) ou a data: a v1
      // subia uma cópia 16:9 curta como vídeo comum; no formato novo (longform/,
      // a partir de ago/2026) tudo ≤ 3 min é corte vertical. Acima de 3 min é longo.
      const isShort = durationSec <= SHORT_MAX_SEC &&
        (/#shorts/i.test(title) || legacy.shortIds.has(v.id) || v.snippet.publishedAt >= LONGFORM_ERA);
      videos.push({
        id: v.id,
        platform: isShort ? "yt_shorts" : "yt_long",
        title: title.replace(/\s*#shorts\b/i, "").trim(),
        case: legacy.caseById.get(v.id) || null,
        publishedAt: v.snippet.publishedAt,
        durationSec,
        url: isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
        thumb: v.snippet.thumbnails?.medium?.url || null,
        views: int(v.statistics.viewCount),
        likes: int(v.statistics.likeCount),
        comments: int(v.statistics.commentCount),
        shares: null,
        avgWatchSec: null,
        avgViewPct: null,
        followersGained: null,
        watchHours: null,
        source: "youtube-data-api",
      });
    }
  }

  console.log(`   ✅ YouTube: ${ch.statistics.subscriberCount} inscritos, ${videos.length} vídeos`);
  return {
    channel: { id: ch.id, avatar: ch.snippet.thumbnails?.medium?.url || null, createdAt: ch.snippet.publishedAt },
    account: {
      followers: int(ch.statistics.subscriberCount),
      views: int(ch.statistics.viewCount),
      videos: int(ch.statistics.videoCount),
      asOf: new Date().toISOString(),
    },
    videos,
  };
}

// ---------------------------------------------------------------------------
// YouTube Analytics API (OAuth) — retenção, horas, inscritos ganhos
// ---------------------------------------------------------------------------

async function ytAnalyticsToken() {
  const { BN_YOUTUBE_CLIENT_ID: id, BN_YOUTUBE_CLIENT_SECRET: secret, BN_YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`token Google: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

async function ytReport(token, params) {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Analytics ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const cols = json.columnHeaders.map((c) => c.name);
  return (json.rows || []).map((r) => Object.fromEntries(r.map((v, i) => [cols[i], v])));
}

async function collectYouTubeAnalytics(yt) {
  let token;
  try {
    token = await ytAnalyticsToken();
  } catch (e) {
    console.warn(`   ⚠️  YouTube Analytics: ${e.message}`);
    return null;
  }
  if (!token) {
    console.log("   ⏭️  YouTube Analytics: sem BN_YOUTUBE_* — retenção e horas assistidas ficam de fora");
    return null;
  }
  const start = (yt?.channel.createdAt || "2026-01-01").slice(0, 10);
  const end = today();
  try {
    // Por vídeo
    const perVideo = await ytReport(token, {
      startDate: start, endDate: end, dimensions: "video", sort: "-views", maxResults: 200,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares",
    });
    // Série diária do canal (backfill do histórico)
    const daily = await ytReport(token, {
      startDate: start, endDate: end, dimensions: "day", sort: "day",
      metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
    });
    // Regras do YPP: horas de vídeos longos (12 meses) e views de Shorts (90 dias)
    let longHours12m = null, shortsViews90d = null;
    try {
      const byType12 = await ytReport(token, { startDate: daysAgo(365), endDate: end, dimensions: "creatorContentType", metrics: "views,estimatedMinutesWatched" });
      const byType90 = await ytReport(token, { startDate: daysAgo(90), endDate: end, dimensions: "creatorContentType", metrics: "views" });
      const vod = byType12.find((r) => r.creatorContentType === "VIDEO_ON_DEMAND");
      longHours12m = vod ? vod.estimatedMinutesWatched / 60 : 0;
      shortsViews90d = byType90.find((r) => r.creatorContentType === "SHORTS")?.views ?? 0;
    } catch (e) {
      console.warn(`   ⚠️  YouTube Analytics (creatorContentType): ${e.message}`);
    }
    console.log(`   ✅ YouTube Analytics: ${perVideo.length} vídeos, ${daily.length} dias`);
    return { perVideo, daily, longHours12m, shortsViews90d };
  } catch (e) {
    console.warn(`   ⚠️  YouTube Analytics: ${e.message} (o refresh token precisa do escopo yt-analytics.readonly)`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TikTok — Display API (user.info.stats + video.list)
// ---------------------------------------------------------------------------

async function tiktokToken() {
  const { BN_TIKTOK_REFRESH_TOKEN: refresh, TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret } = process.env;
  if (refresh && key && secret) {
    try {
      const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
        body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh }),
      });
      const data = await res.json();
      if (data.access_token) {
        process.env.BN_TIKTOK_ACCESS_TOKEN = data.access_token;
        updateEnvVar("BN_TIKTOK_ACCESS_TOKEN", data.access_token);
        if (data.refresh_token && data.refresh_token !== refresh) updateEnvVar("BN_TIKTOK_REFRESH_TOKEN", data.refresh_token);
        if (data.scope) console.log(`   ℹ️  TikTok escopos: ${data.scope}`);
      }
    } catch (e) {
      console.warn(`   ⚠️  TikTok: não renovou o token (${e.message}) — tentando o atual`);
    }
  }
  return process.env.BN_TIKTOK_ACCESS_TOKEN || null;
}

async function collectTikTok() {
  const token = await tiktokToken();
  if (!token) {
    console.log("   ⏭️  TikTok: sem BN_TIKTOK_ACCESS_TOKEN — use manual.json por enquanto");
    return null;
  }
  const auth = { Authorization: `Bearer ${token}` };
  const out = { account: null, videos: [] };

  try {
    const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url,follower_count,likes_count,video_count", { headers: auth });
    const u = (await res.json())?.data?.user;
    if (res.ok && u) {
      out.account = { followers: u.follower_count ?? null, likes: u.likes_count ?? null, videos: u.video_count ?? null, views: null, asOf: new Date().toISOString() };
      out.avatar = u.avatar_url || null;
    } else console.warn(`   ⚠️  TikTok user/info ${res.status} — falta o escopo user.info.stats?`);
  } catch (e) {
    console.warn(`   ⚠️  TikTok user/info: ${e.message}`);
  }

  try {
    const fields = "id,title,video_description,duration,create_time,share_url,cover_image_url,view_count,like_count,comment_count,share_count";
    let cursor;
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ max_count: 20, ...(cursor && { cursor }) }),
      });
      if (!res.ok) {
        console.warn(`   ⚠️  TikTok video/list ${res.status} — falta o escopo video.list?`);
        break;
      }
      const data = (await res.json()).data || {};
      for (const v of data.videos || []) {
        out.videos.push({
          id: String(v.id),
          platform: "tiktok",
          title: (v.title || v.video_description || "").split("\n")[0].slice(0, 140),
          case: null,
          publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
          durationSec: v.duration ?? null,
          url: v.share_url || null,
          thumb: v.cover_image_url || null,
          views: v.view_count ?? null,
          likes: v.like_count ?? null,
          comments: v.comment_count ?? null,
          shares: v.share_count ?? null,
          avgWatchSec: null,
          avgViewPct: null,
          followersGained: null,
          watchHours: null,
          source: "tiktok-display-api",
        });
      }
      if (!data.has_more) break;
      cursor = data.cursor;
    }
  } catch (e) {
    console.warn(`   ⚠️  TikTok video/list: ${e.message}`);
  }

  if (out.account) out.account.views = out.videos.reduce((s, v) => s + (v.views || 0), 0) || null;
  console.log(`   ✅ TikTok: ${out.account?.followers ?? "?"} seguidores, ${out.videos.length} vídeos`);
  return out;
}

// ---------------------------------------------------------------------------
// Instagram Reels — Graph API (conta profissional ligada a uma página)
// ---------------------------------------------------------------------------

async function collectInstagram() {
  const { BN_IG_USER_ID: igId, BN_IG_ACCESS_TOKEN: token } = process.env;
  if (!igId || !token) {
    console.log("   ⏭️  Instagram: sem BN_IG_USER_ID/BN_IG_ACCESS_TOKEN — pulando");
    return null;
  }
  const g = async (path, params) => {
    const res = await fetch(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json;
  };
  try {
    const user = await g(igId, { fields: "username,followers_count,media_count,profile_picture_url" });
    CHANNEL.instagram = { handle: user.username, url: `https://www.instagram.com/${user.username}` };
    const media = await g(`${igId}/media`, { fields: "id,caption,media_product_type,timestamp,permalink,thumbnail_url,like_count,comments_count", limit: 100 });
    const videos = [];
    for (const m of media.data || []) {
      if (m.media_product_type !== "REELS") continue;
      let ins = {};
      try {
        const r = await g(`${m.id}/insights`, { metric: "views,shares,ig_reels_avg_watch_time" });
        ins = Object.fromEntries(r.data.map((d) => [d.name, d.values?.[0]?.value]));
      } catch {}
      videos.push({
        id: m.id,
        platform: "reels",
        title: (m.caption || "").split("\n")[0].slice(0, 140),
        case: null,
        publishedAt: m.timestamp,
        durationSec: null,
        url: m.permalink,
        thumb: m.thumbnail_url || null,
        views: ins.views ?? null,
        likes: m.like_count ?? null,
        comments: m.comments_count ?? null,
        shares: ins.shares ?? null,
        avgWatchSec: ins.ig_reels_avg_watch_time != null ? ins.ig_reels_avg_watch_time / 1000 : null,
        avgViewPct: null,
        followersGained: null,
        watchHours: null,
        source: "instagram-graph-api",
      });
    }
    console.log(`   ✅ Instagram: ${user.followers_count} seguidores, ${videos.length} Reels`);
    return {
      account: { followers: user.followers_count, videos: user.media_count, views: videos.reduce((s, v) => s + (v.views || 0), 0), asOf: new Date().toISOString() },
      videos,
    };
  } catch (e) {
    console.warn(`   ⚠️  Instagram: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Monta o data.json
// ---------------------------------------------------------------------------

// Lê a v1 só para herdar o nome do caso e saber quais IDs eram Shorts
function loadLegacy() {
  const v1 = loadJson(V1_DATA_PATH, { runs: [] });
  const caseById = new Map();
  const shortIds = new Set();
  for (const run of v1.runs || []) {
    if (run.channel !== "brazil-noir") continue;
    for (const p of run.publish || []) {
      const id = /(?:shorts\/|watch\?v=)([\w-]{6,})/.exec(p.url || "")?.[1];
      if (!id) continue;
      caseById.set(id, caseFromTopic(run.topic));
      if (p.platform === "youtube_shorts") shortIds.add(id);
    }
  }
  return { caseById, shortIds };
}

// Uma linha por dia e plataforma: totais acumulados + o que entrou no dia
function upsertDaily(daily, row) {
  const i = daily.findIndex((d) => d.date === row.date && d.platform === row.platform);
  if (i >= 0) daily[i] = { ...daily[i], ...Object.fromEntries(Object.entries(row).filter(([, v]) => v != null)) };
  else daily.push(row);
}

export async function collectBrazilNoir() {
  console.log("🕵️ [Brazil Noir] Coletando métricas para a dashboard v2...");
  const prev = loadJson(OUT_PATH, {});
  const legacy = loadLegacy();
  const daily = (prev.daily || []).slice();
  const accounts = { ...(prev.accounts || {}) };
  const sources = {};
  let videos = [];
  const channel = { ...CHANNEL, ...(prev.channel || {}) };

  const [yt, tk, ig] = await Promise.all([
    collectYouTube(legacy).catch((e) => (console.warn(`   ⚠️  YouTube: ${e.message}`), null)),
    collectTikTok(),
    collectInstagram(),
  ]);
  const yta = await collectYouTubeAnalytics(yt);

  // Mantém vídeos de fontes que falharam desta vez (não apaga dado bom)
  const keepFrom = (platforms) => (prev.videos || []).filter((v) => platforms.includes(v.platform));

  if (yt) {
    channel.youtube = { ...CHANNEL.youtube, ...yt.channel };
    accounts.youtube = yt.account;
    sources.youtube = "api";
    if (yta) {
      sources.youtube = "api+analytics";
      const byId = new Map(yta.perVideo.map((r) => [r.video, r]));
      for (const v of yt.videos) {
        const r = byId.get(v.id);
        if (!r) continue;
        v.avgWatchSec = r.averageViewDuration;
        v.avgViewPct = r.averageViewPercentage;
        v.followersGained = r.subscribersGained;
        v.watchHours = r.estimatedMinutesWatched / 60;
        v.shares = r.shares;
      }
      // Reconstrói inscritos acumulados de trás pra frente a partir do total atual
      let subs = yt.account.followers;
      let views = yt.account.views;
      for (const d of [...yta.daily].reverse()) {
        upsertDaily(daily, { date: d.day, platform: "youtube", followers: subs, totalViews: views, views: d.views, followersGained: d.subscribersGained - d.subscribersLost, watchHours: d.estimatedMinutesWatched / 60 });
        subs -= d.subscribersGained - d.subscribersLost;
        views -= d.views;
      }
      accounts.youtube.longWatchHours12m = yta.longHours12m;
      accounts.youtube.shortsViews90d = yta.shortsViews90d;
    }
    videos.push(...yt.videos);
    upsertDaily(daily, { date: today(), platform: "youtube", followers: yt.account.followers, totalViews: yt.account.views });
  } else videos.push(...keepFrom(["yt_long", "yt_shorts"]));

  if (tk && (tk.account || tk.videos.length)) {
    if (tk.account) accounts.tiktok = tk.account;
    sources.tiktok = "api";
    videos.push(...tk.videos);
    if (tk.account) upsertDaily(daily, { date: today(), platform: "tiktok", followers: tk.account.followers, totalViews: tk.account.views, likes: tk.account.likes });
  } else videos.push(...keepFrom(["tiktok"]));

  if (ig) {
    accounts.instagram = ig.account;
    channel.instagram = CHANNEL.instagram;
    sources.instagram = "api";
    videos.push(...ig.videos);
    upsertDaily(daily, { date: today(), platform: "instagram", followers: ig.account.followers, totalViews: ig.account.views });
  } else videos.push(...keepFrom(["reels"]));

  // Fonte que não respondeu agora mas já respondeu antes continua marcada
  for (const k of ["youtube", "tiktok", "instagram"]) if (!sources[k] && prev.sources?.[k]) sources[k] = prev.sources[k] + " (anterior)";

  daily.sort((a, b) => (a.date + a.platform).localeCompare(b.date + b.platform));
  videos.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

  const out = { schema: 1, mode: "real", generatedAt: new Date().toISOString(), sources, channel, accounts, daily, videos };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`✅ [Brazil Noir] ${videos.length} vídeos, ${daily.length} linhas diárias → ${OUT_PATH}`);
  return { videos: videos.length, sources };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  collectBrazilNoir().catch((e) => {
    console.error("❌ Erro no coletor do Brazil Noir:", e.message);
    process.exit(1);
  });
}

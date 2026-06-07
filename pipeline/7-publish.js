/**
 * Módulo 7: Publish — Upload para YouTube e TikTok
 *
 * Faz o upload dos vídeos gerados para as plataformas
 * com título, descrição, tags e hashtags otimizados.
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../.env");
const settings = JSON.parse(
  readFileSync(join(__dirname, "../config/settings.json"), "utf-8")
);

// ---------------------------------------------------------------------------
// YouTube Upload
// ---------------------------------------------------------------------------

async function refreshYouTubeToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Erro ao renovar token YouTube: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function uploadToYouTube(videoPath, scriptData, topicData) {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log("   ⚠️  YouTube não configurado — pulando");
    return null;
  }

  console.log("📺 [Publish] Fazendo upload para YouTube...");

  const accessToken = await refreshYouTubeToken();

  // Monta a descrição com CTA do Hotmart
  const description = [
    scriptData.description?.youtube || scriptData.script.slice(0, 200) + "...",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    topicData.hotmartCta || settings.niche.hotmartProducts[0].cta,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "#" + (settings.youtube.defaultTags || []).join(" #"),
  ].join("\n");

  const metadata = {
    snippet: {
      title: scriptData.title?.youtube || topicData.topic,
      description,
      tags: [
        ...(settings.youtube.defaultTags || []),
        ...(scriptData.tags || []),
      ].slice(0, 15),
      categoryId: settings.youtube.category,
      defaultLanguage: "pt",
    },
    status: {
      privacyStatus: settings.youtube.privacyStatus || "public",
      selfDeclaredMadeForKids: false,
    },
  };

  // Passo 1: Iniciar upload resumable
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": statSync(videoPath).size,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`YouTube init upload erro: ${err}`);
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube não retornou upload URL");

  // Passo 2: Upload do arquivo
  const videoBuffer = readFileSync(videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": videoBuffer.length,
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`YouTube upload erro: ${err}`);
  }

  const video = await uploadRes.json();
  const videoId = video.id;
  const videoUrl = `https://www.youtube.com/shorts/${videoId}`;

  console.log(`✅ [YouTube] Upload concluído: ${videoUrl}`);
  return { videoId, url: videoUrl, platform: "youtube" };
}

// ---------------------------------------------------------------------------
// TikTok Upload
// ---------------------------------------------------------------------------

// Atualiza (ou adiciona) uma variável no arquivo .env, preservando o resto.
function updateEnvVar(key, value) {
  if (!existsSync(ENV_PATH)) return;
  let content = readFileSync(ENV_PATH, "utf-8");
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content.trimEnd() + `\n${key}=${value}\n`;
  writeFileSync(ENV_PATH, content);
}

// Renova o access_token do TikTok usando o refresh_token salvo. O TikTok
// pode rotacionar o refresh_token a cada renovação — por isso gravamos os
// dois de volta no .env e também no process.env (pra valer no run atual).
async function refreshTikTokToken() {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) throw new Error(`Erro ao renovar token TikTok: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`Erro ao renovar token TikTok: ${JSON.stringify(data)}`);

  process.env.TIKTOK_ACCESS_TOKEN = data.access_token;
  updateEnvVar("TIKTOK_ACCESS_TOKEN", data.access_token);

  if (data.refresh_token) {
    process.env.TIKTOK_REFRESH_TOKEN = data.refresh_token;
    updateEnvVar("TIKTOK_REFRESH_TOKEN", data.refresh_token);
  }

  return data.access_token;
}

async function uploadToTikTok(videoPath, scriptData, topicData) {
  if (!process.env.TIKTOK_ACCESS_TOKEN && !process.env.TIKTOK_REFRESH_TOKEN) {
    console.log("   ⚠️  TikTok não configurado — pulando");
    return null;
  }

  console.log("🎵 [Publish] Fazendo upload para TikTok...");

  // Sempre renova o token antes de publicar — evita falhas por expiração
  // (o access_token do TikTok dura só ~24h).
  let accessToken;
  try {
    accessToken = await refreshTikTokToken();
  } catch (e) {
    console.warn(`   ⚠️  Não foi possível renovar o token do TikTok (${e.message}) — tentando com o token atual...`);
    accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    if (!accessToken) throw e;
  }

  // Monta a descrição com hashtags
  const hashtags = [
    ...(settings.tiktok.defaultHashtags || []),
    ...(scriptData.hashtags || []),
  ]
    .slice(0, 10)
    .join(" ");

  const caption = `${scriptData.title?.tiktok || topicData.topic} ${hashtags}`;

  // Passo 1: Iniciar upload
  const initRes = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 2200),
          privacy_level: settings.tiktok.privacyLevel || "PUBLIC_TO_EVERYONE",
          disable_duet: settings.tiktok.disableDuet || false,
          disable_stitch: settings.tiktok.disableStitch || false,
          disable_comment: settings.tiktok.disableComment || false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: statSync(videoPath).size,
          chunk_size: statSync(videoPath).size,
          total_chunk_count: 1,
        },
      }),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`TikTok init upload erro: ${err}`);
  }

  const initData = await initRes.json();
  const uploadUrl = initData.data?.upload_url;
  const publishId = initData.data?.publish_id;

  if (!uploadUrl) throw new Error("TikTok não retornou upload URL");

  // Passo 2: Upload do arquivo
  const videoBuffer = readFileSync(videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Range": `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
      "Content-Type": "video/mp4",
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`TikTok upload erro: ${err}`);
  }

  console.log(`✅ [TikTok] Upload concluído | Publish ID: ${publishId}`);
  return {
    publishId,
    url: `https://www.tiktok.com/@codexmentalbr`,
    platform: "tiktok",
  };
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function publishVideos(videoData, scriptData, topicData) {
  console.log("🚀 [Publish] Iniciando publicação...");

  const results = [];

  // YouTube
  if (settings.youtube.enabled && videoData.youtube) {
    try {
      const ytResult = await uploadToYouTube(
        videoData.youtube,
        scriptData,
        topicData
      );
      if (ytResult) results.push(ytResult);
    } catch (e) {
      console.error(`❌ Erro YouTube: ${e.message}`);
    }
  }

  // TikTok
  if (settings.tiktok.enabled && videoData.tiktok) {
    try {
      const ttResult = await uploadToTikTok(
        videoData.tiktok,
        scriptData,
        topicData
      );
      if (ttResult) results.push(ttResult);
    } catch (e) {
      console.error(`❌ Erro TikTok: ${e.message}`);
    }
  }

  if (results.length === 0) {
    console.log("⚠️  Nenhuma plataforma publicou. Verifique as credenciais no .env");
  } else {
    console.log(`✅ [Publish] ${results.length} plataforma(s) publicada(s)!`);
    results.forEach((r) => console.log(`   → ${r.platform}: ${r.url}`));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/7-publish.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("ℹ️  Módulo 7 carregado. Execute via pipeline/index.js para publicação completa.");
  console.log("   → node pipeline/index.js");
}

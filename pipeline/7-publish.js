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

async function uploadToYouTube(videoPath, scriptData, topicData, isShorts = false) {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log("   ⚠️  YouTube não configurado — pulando");
    return null;
  }

  console.log(`📺 [Publish] Fazendo upload para YouTube${isShorts ? " (Shorts)" : ""}...`);

  const accessToken = await refreshYouTubeToken();

  const linktree = settings.niche.links?.linktree;

  // Monta a descrição com link do Linktree + CTA do Hotmart
  const description = [
    scriptData.description?.youtube || scriptData.script.slice(0, 200) + "...",
    "",
    ...(linktree ? [`🔗 Acesse: ${linktree}`, ""] : []),
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    scriptData.promotedProduct?.cta || topicData.hotmartCta || settings.niche.hotmartProducts[0].cta,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "#" + (settings.youtube.defaultTags || []).join(" #"),
    ...(isShorts ? ["#Shorts"] : []),
  ].join("\n");

  // No título dos Shorts, garante a hashtag #Shorts pra ajudar o YouTube a
  // classificar corretamente o vídeo vertical como Short.
  const baseTitle = scriptData.title?.youtube || topicData.topic;
  const title = isShorts && !/#shorts/i.test(baseTitle) ? `${baseTitle} #Shorts` : baseTitle;

  const metadata = {
    snippet: {
      title,
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
  // Vídeos verticais/curtos só viram Shorts de fato no link /shorts/...;
  // o vídeo horizontal "tradicional" usa /watch — o YouTube redireciona
  // sozinho caso o formato não seja compatível com Shorts.
  const videoUrl = isShorts
    ? `https://www.youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`✅ [YouTube${isShorts ? " Shorts" : ""}] Upload concluído: ${videoUrl}`);
  return { videoId, url: videoUrl, platform: isShorts ? "youtube_shorts" : "youtube" };
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

  const linktree = settings.niche.links?.linktree;
  const linkLine = linktree ? `🔗 ${linktree.replace(/^https?:\/\//, "")}` : "";

  const caption = [scriptData.title?.tiktok || topicData.topic, linkLine, hashtags]
    .filter(Boolean)
    .join(" ");

  // Passo 1: Iniciar upload
  // Usa o endpoint de "inbox" (rascunho) enquanto o app não estiver auditado
  // pelo TikTok. O vídeo vai para a caixa de entrada do criador e pode ser
  // revisado/publicado manualmente. Quando o app for aprovado, basta trocar
  // a URL para "post/publish/video/init/" e adicionar post_info de volta.
  const videoSize = statSync(videoPath).size;
  const initRes = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: videoSize,
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

  console.log(`✅ [TikTok] Vídeo enviado como rascunho (inbox) | Publish ID: ${publishId}`);
  console.log(`   → Abra o app do TikTok → Inbox → revise e publique manualmente`);
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

  // YouTube — vídeo "tradicional" (horizontal)
  if (settings.youtube.enabled && videoData.youtube) {
    try {
      const ytResult = await uploadToYouTube(
        videoData.youtube,
        scriptData,
        topicData,
        false
      );
      if (ytResult) results.push(ytResult);
    } catch (e) {
      console.error(`❌ Erro YouTube: ${e.message}`);
    }
  }

  // YouTube Shorts — versão vertical (mesmo arquivo usado no TikTok), só
  // sobe se for um arquivo diferente do "tradicional" pra não duplicar.
  if (
    settings.youtube.enabled &&
    videoData.youtubeShorts &&
    videoData.youtubeShorts !== videoData.youtube
  ) {
    try {
      const ytShortsResult = await uploadToYouTube(
        videoData.youtubeShorts,
        scriptData,
        topicData,
        true
      );
      if (ytShortsResult) results.push(ytShortsResult);
    } catch (e) {
      console.error(`❌ Erro YouTube Shorts: ${e.message}`);
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

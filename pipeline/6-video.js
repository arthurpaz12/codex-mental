/**
 * Módulo 6: Video — Montagem do vídeo com Creatomate
 *
 * Combina áudio (ElevenLabs) + footage (Pexels) + thumbnail (DALL-E)
 * em um vídeo final com legendas animadas e música de fundo.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CREATOMATE_API_URL = "https://api.creatomate.com/v1";

// ---------------------------------------------------------------------------
// Polling — aguarda renderização completar
// ---------------------------------------------------------------------------

async function pollRender(renderId, apiKey, maxWaitMs = 300000) {
  const start = Date.now();
  const interval = 5000; // verifica a cada 5s

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval));

    const res = await fetch(`${CREATOMATE_API_URL}/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) throw new Error(`Creatomate API erro ${res.status}`);
    const render = await res.json();

    console.log(`   → Status: ${render.status}`);

    if (render.status === "succeeded") return render;
    if (render.status === "failed")
      throw new Error(`Render falhou: ${render.error_message}`);
  }

  throw new Error("Timeout aguardando renderização (5 min)");
}

// ---------------------------------------------------------------------------
// Download do vídeo renderizado
// ---------------------------------------------------------------------------

async function downloadVideo(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro ao baixar vídeo: ${res.status}`);
  const buffer = await res.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

// ---------------------------------------------------------------------------
// Monta o payload para o Creatomate
// ---------------------------------------------------------------------------

function buildCreatomatePayload(scriptData, voiceData, mediaData, thumbnailData, format) {
  const settings = JSON.parse(
    readFileSync(join(__dirname, "../config/settings.json"), "utf-8")
  );

  const isYoutube = format === "youtube";
  const templateId = isYoutube
    ? process.env.CREATOMATE_TEMPLATE_YOUTUBE
    : process.env.CREATOMATE_TEMPLATE_TIKTOK;

  // Pega os clips de vídeo disponíveis
  const videoClips = (mediaData.videos || []).slice(0, 5).map((v, i) => ({
    [`clip_${i + 1}`]: v.localPath || v.url,
  }));

  const modifications = {
    // Áudio principal (narração)
    narration: voiceData.audioPath,

    // Thumbnail como primeiro frame
    thumbnail: isYoutube ? thumbnailData?.youtube : thumbnailData?.tiktok,

    // Clips de vídeo como B-roll
    ...Object.assign({}, ...videoClips),

    // Configurações de legenda
    subtitle_text: scriptData.script,
    subtitle_font_size: settings.video.subtitles.fontSize,
    subtitle_color: settings.video.subtitles.fontColor,
    subtitle_highlight_color: settings.video.subtitles.highlightColor,

    // Música de fundo (volume baixo)
    music_volume: settings.video.music.volume,
  };

  // Remove valores nulos/undefined
  Object.keys(modifications).forEach(
    (k) => modifications[k] == null && delete modifications[k]
  );

  return { template_id: templateId, modifications };
}

// ---------------------------------------------------------------------------
// Renderização via Creatomate (com template)
// ---------------------------------------------------------------------------

async function renderWithTemplate(payload, apiKey) {
  const res = await fetch(`${CREATOMATE_API_URL}/renders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Creatomate API erro ${res.status}: ${err}`);
  }

  const renders = await res.json();
  return Array.isArray(renders) ? renders[0] : renders;
}

// ---------------------------------------------------------------------------
// Renderização fallback (sem template — composição básica)
// ---------------------------------------------------------------------------

async function renderFallback(scriptData, voiceData, mediaData, outputPath) {
  console.log("   ⚠️  Template não configurado — usando renderização básica");
  console.log("   → Para vídeos completos, configure CREATOMATE_TEMPLATE_YOUTUBE/TIKTOK no .env");

  // Salva um JSON com todos os dados para montagem manual ou futura integração
  const fallbackData = {
    status: "pending_render",
    message: "Configure o template Creatomate para renderização automática",
    assets: {
      audio: voiceData.audioPath,
      videos: (mediaData.videos || []).map((v) => v.localPath),
      script: scriptData.script,
      title: scriptData.title,
    },
  };

  writeFileSync(outputPath.replace(".mp4", "-assets.json"), JSON.stringify(fallbackData, null, 2));
  return null;
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function assembleVideo(scriptData, voiceData, mediaData, thumbnailData, outputDir) {
  const apiKey = process.env.CREATOMATE_API_KEY;

  mkdirSync(join(outputDir, "video"), { recursive: true });

  console.log("🎞️  [Video] Montando vídeo com Creatomate...");

  const results = {};

  for (const format of ["youtube", "tiktok"]) {
    const outputPath = join(outputDir, "video", `${format}.mp4`);
    const templateId =
      format === "youtube"
        ? process.env.CREATOMATE_TEMPLATE_YOUTUBE
        : process.env.CREATOMATE_TEMPLATE_TIKTOK;

    if (!apiKey || !templateId) {
      results[format] = await renderFallback(scriptData, voiceData, mediaData, outputPath);
      continue;
    }

    console.log(`   → Renderizando ${format.toUpperCase()}...`);

    const payload = buildCreatomatePayload(
      scriptData, voiceData, mediaData, thumbnailData, format
    );

    const render = await renderWithTemplate(payload, apiKey);
    console.log(`   → Render ID: ${render.id} | Aguardando...`);

    const completed = await pollRender(render.id, apiKey);
    await downloadVideo(completed.url, outputPath);

    results[format] = outputPath;
    console.log(`   ✅ ${format.toUpperCase()} salvo: ${outputPath}`);
  }

  console.log("✅ [Video] Montagem concluída!");

  return {
    youtube: results.youtube || null,
    tiktok: results.tiktok || null,
    outputDir: join(outputDir, "video"),
  };
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/6-video.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("ℹ️  Módulo 6 carregado. Execute via pipeline/index.js para teste completo.");
  console.log("   → node pipeline/index.js --step 1,2,3,4,5,6");
}

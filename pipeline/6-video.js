/**
 * Módulo 6: Video — Montagem local com FFmpeg (gratuito)
 *
 * Combina áudio (ElevenLabs) + footage (Pexels) + thumbnail
 * em um vídeo final com legendas e música de fundo.
 * Sem custo de API externa.
 */

import "dotenv/config";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detecta o caminho do ffmpeg
function getFFmpegPath() {
  try {
    return execSync("which ffmpeg").toString().trim();
  } catch {
    return "ffmpeg";
  }
}

// ---------------------------------------------------------------------------
// Executa comando FFmpeg
// ---------------------------------------------------------------------------

function runFFmpeg(args, label = "") {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFFmpegPath();
    console.log(`   → FFmpeg${label ? " [" + label + "]" : ""}...`);

    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg falhou (${code}): ${stderr.slice(-500)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Gera arquivo de legendas SRT a partir do script
// ---------------------------------------------------------------------------

function generateSRT(script, durationSeconds) {
  const sentences = script
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const timePerSentence = durationSeconds / sentences.length;
  let srt = "";

  sentences.forEach((sentence, i) => {
    const start = i * timePerSentence;
    const end = (i + 1) * timePerSentence;

    const fmt = (s) => {
      const h = Math.floor(s / 3600).toString().padStart(2, "0");
      const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
      const sec = Math.floor(s % 60).toString().padStart(2, "0");
      const ms = Math.floor((s % 1) * 1000).toString().padStart(3, "0");
      return `${h}:${m}:${sec},${ms}`;
    };

    srt += `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${sentence}\n\n`;
  });

  return srt;
}

// ---------------------------------------------------------------------------
// Monta vídeo YouTube (landscape 1280x720)
// ---------------------------------------------------------------------------

async function buildYoutubeVideo(audioPath, videoClips, thumbnailPath, srtPath, outputPath, duration) {
  const hasClips = videoClips && videoClips.length > 0;

  if (hasClips) {
    // Cria lista de clips para concatenação
    const listPath = outputPath.replace(".mp4", "-list.txt");
    const clipList = videoClips
      .map((v) => `file '${v.localPath || v}'`)
      .join("\n");
    writeFileSync(listPath, clipList);

    // Concatena clips + audio + legendas
    await runFFmpeg([
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-i", audioPath,
      "-vf", `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,subtitles=${srtPath}:force_style='FontName=Arial,FontSize=22,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2'`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y",
      outputPath,
    ], "YouTube");
  } else {
    // Fallback: usa thumbnail como imagem estática
    await runFFmpeg([
      "-loop", "1", "-i", thumbnailPath,
      "-i", audioPath,
      "-vf", `scale=1280:720,subtitles=${srtPath}:force_style='FontName=Arial,FontSize=22,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2'`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(duration),
      "-shortest", "-y",
      outputPath,
    ], "YouTube (imagem)");
  }
}

// ---------------------------------------------------------------------------
// Monta vídeo TikTok (portrait 1080x1920)
// ---------------------------------------------------------------------------

async function buildTiktokVideo(audioPath, videoClips, thumbnailPath, srtPath, outputPath, duration) {
  const hasClips = videoClips && videoClips.length > 0;

  if (hasClips) {
    const listPath = outputPath.replace(".mp4", "-list.txt");
    const clipList = videoClips
      .map((v) => `file '${v.localPath || v}'`)
      .join("\n");
    writeFileSync(listPath, clipList);

    await runFFmpeg([
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-i", audioPath,
      "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles=${srtPath}:force_style='FontName=Arial,FontSize=28,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=3,Bold=1,Alignment=2,MarginV=80'`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y",
      outputPath,
    ], "TikTok");
  } else {
    await runFFmpeg([
      "-loop", "1", "-i", thumbnailPath,
      "-i", audioPath,
      "-vf", `scale=1080:1920,subtitles=${srtPath}:force_style='FontName=Arial,FontSize=28,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=3,Bold=1,Alignment=2,MarginV=80'`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(duration),
      "-shortest", "-y",
      outputPath,
    ], "TikTok (imagem)");
  }
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function assembleVideo(scriptData, voiceData, mediaData, thumbnailData, outputDir) {
  mkdirSync(join(outputDir, "video"), { recursive: true });

  console.log("🎞️  [Video] Montando vídeo com FFmpeg...");

  const audioPath = voiceData.audioPath;
  const duration = voiceData.duration || 60;
  const videoClips = mediaData?.videos || [];

  // Gera legenda SRT
  const srtPath = join(outputDir, "video", "subtitles.srt");
  const srt = generateSRT(scriptData.script, duration);
  writeFileSync(srtPath, srt, "utf-8");
  console.log(`   → Legendas geradas: ${srt.split("\n\n").length - 1} blocos`);

  const results = {};

  // YouTube
  const youtubePath = join(outputDir, "video", "youtube.mp4");
  const youtubeThumbnail = thumbnailData?.youtube || null;
  try {
    await buildYoutubeVideo(audioPath, videoClips, youtubeThumbnail, srtPath, youtubePath, duration);
    results.youtube = youtubePath;
    console.log(`   ✅ YouTube: ${youtubePath}`);
  } catch (e) {
    console.error(`   ❌ YouTube falhou: ${e.message}`);
  }

  // TikTok
  const tiktokPath = join(outputDir, "video", "tiktok.mp4");
  const tiktokThumbnail = thumbnailData?.tiktok || null;
  try {
    await buildTiktokVideo(audioPath, videoClips, tiktokThumbnail, srtPath, tiktokPath, duration);
    results.tiktok = tiktokPath;
    console.log(`   ✅ TikTok: ${tiktokPath}`);
  } catch (e) {
    console.error(`   ❌ TikTok falhou: ${e.message}`);
  }

  console.log("✅ [Video] Montagem concluída!");

  return {
    youtube: results.youtube || null,
    tiktok: results.tiktok || null,
    outputDir: join(outputDir, "video"),
  };
}

// ---------------------------------------------------------------------------
// Execução direta
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("ℹ️  Módulo 6 (FFmpeg) carregado. Execute via pipeline/index.js");
  console.log("   → node pipeline/index.js");
}

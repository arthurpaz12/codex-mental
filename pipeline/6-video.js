/**
 * Módulo 6: Video — Montagem local com FFmpeg (gratuito)
 *
 * Combina áudio (ElevenLabs) + footage (Pexels) + thumbnail
 * em um vídeo final com legendas PNG overlay e blur background no TikTok.
 * Não depende de libass ou freetype.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detecta o caminho do ffmpeg
function getFFmpegPath() {
  try { return execSync("which ffmpeg").toString().trim(); }
  catch { return "ffmpeg"; }
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
      else reject(new Error(`FFmpeg falhou (${code}): ${stderr.slice(-800)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Gera arquivo de legendas SRT a partir do script
// ---------------------------------------------------------------------------

function generateSRT(script, durationSeconds) {
  const rawSentences = script
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Quebra sentenças longas em chunks de ~55 chars
  const chunks = [];
  for (const sentence of rawSentences) {
    if (sentence.length <= 60) {
      chunks.push(sentence);
    } else {
      const words = sentence.split(" ");
      let current = "";
      for (const word of words) {
        if ((current + " " + word).trim().length > 60) {
          if (current) chunks.push(current.trim());
          current = word;
        } else {
          current = (current + " " + word).trim();
        }
      }
      if (current) chunks.push(current.trim());
    }
  }

  const timePerChunk = durationSeconds / chunks.length;

  const fmt = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    const ms = Math.floor((s % 1) * 1000).toString().padStart(3, "0");
    return `${h}:${m}:${sec},${ms}`;
  };

  let srt = "";
  const blocks = [];
  chunks.forEach((chunk, i) => {
    const start = i * timePerChunk;
    const end = Math.min((i + 1) * timePerChunk, durationSeconds);
    srt += `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${chunk}\n\n`;
    blocks.push({ text: chunk, start, end });
  });

  return { srt, blocks };
}

// ---------------------------------------------------------------------------
// Gera imagens PNG de legenda com Sharp (sem libass)
// ---------------------------------------------------------------------------

async function generateSubtitleImages(blocks, tmpDir, videoWidth, isVertical) {
  mkdirSync(tmpDir, { recursive: true });
  const imgWidth = videoWidth;
  const fontSize = isVertical ? 54 : 44;
  const boxHeight = isVertical ? 110 : 90;
  const images = [];

  for (let i = 0; i < blocks.length; i++) {
    const { text, start, end } = blocks[i];
    const imgPath = join(tmpDir, `sub-${String(i).padStart(4, "0")}.png`);

    // SVG com fundo semi-transparente e texto branco centralizado
    const svg = `<svg width="${imgWidth}" height="${boxHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${imgWidth}" height="${boxHeight}" fill="rgba(0,0,0,0.65)" rx="8"/>
  <text
    x="${imgWidth / 2}" y="${boxHeight / 2}"
    font-family="Arial Black, Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="bold"
    fill="white"
    text-anchor="middle"
    dominant-baseline="middle"
    stroke="black"
    stroke-width="3"
    paint-order="stroke"
  >${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>
</svg>`;

    await sharp(Buffer.from(svg)).png().toFile(imgPath);
    images.push({ path: imgPath, start, end });
  }

  return images;
}

// ---------------------------------------------------------------------------
// Monta vídeo com legendas PNG overlay via FFmpeg filter_complex
// ---------------------------------------------------------------------------

async function buildVideoWithSubtitles(baseArgs, subtitleImages, videoWidth, videoHeight, isVertical, outputPath, label) {
  const yPos = isVertical ? Math.round(videoHeight * 0.83) : Math.round(videoHeight * 0.85);
  const subW = videoWidth;

  // Adiciona cada imagem de legenda como input extra
  const extraInputs = [];
  subtitleImages.forEach((s) => {
    extraInputs.push("-i", s.path);
  });

  // Monta filter_complex com chain de overlays
  let filterChain = "";
  const mainInput = "[base]";

  // Primeiro rotula o stream de vídeo base
  // O índice 0 é o vídeo concat/loop, os subsequentes são as legendas
  const subStartIdx = baseArgs.filter(a => a === "-i").length; // conta inputs existentes

  // Chain: [base] → overlay sub0 → overlay sub1 → ...
  let prevLabel = "base";
  subtitleImages.forEach((sub, i) => {
    const nextLabel = i === subtitleImages.length - 1 ? "out" : `s${i}`;
    const subIdx = subStartIdx + i;
    const enableExpr = `between(t,${sub.start.toFixed(3)},${sub.end.toFixed(3)})`;
    filterChain +=
      `[${prevLabel}][${subIdx}:v]overlay=x=(W-w)/2:y=${yPos}:enable='${enableExpr}'[${nextLabel}];`;
    prevLabel = nextLabel;
  });

  // Remove último ';'
  filterChain = filterChain.replace(/;$/, "");

  // Reconstrói args com os inputs extras e filter_complex
  const finalArgs = [...baseArgs, ...extraInputs, "-filter_complex", `[0:v]copy[base];${filterChain}`, "-map", "[out]"];
  // Remove -vf se existir (incompatível com filter_complex)
  const cleanArgs = [];
  for (let i = 0; i < finalArgs.length; i++) {
    if (finalArgs[i] === "-vf") { i++; continue; } // pula -vf e seu valor
    cleanArgs.push(finalArgs[i]);
  }
  // Adiciona áudio e output
  cleanArgs.push("-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-shortest", "-y", outputPath);

  await runFFmpeg(cleanArgs, label);
}

// ---------------------------------------------------------------------------
// Monta vídeo YouTube (landscape 1280x720)
// ---------------------------------------------------------------------------

async function buildYoutubeVideo(audioPath, videoClips, thumbnailPath, subtitleImages, outputPath, duration) {
  const hasClips = videoClips && videoClips.length > 0;

  if (hasClips) {
    const listPath = outputPath.replace(".mp4", "-list.txt");
    writeFileSync(listPath, videoClips.map((v) => `file '${v.localPath || v}'`).join("\n"));

    // Base: concat + escala YouTube
    const baseArgs = [
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-i", audioPath,
      "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    ];

    if (subtitleImages && subtitleImages.length > 0) {
      try {
        await buildVideoWithSubtitles(baseArgs, subtitleImages, 1280, 720, false, outputPath, "YouTube+legendas");
        return;
      } catch (e) {
        console.warn(`   ⚠️  Legendas overlay falhou: ${e.message.slice(0, 100)}`);
      }
    }

    // Fallback sem legendas
    await runFFmpeg([
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-i", audioPath,
      "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y", outputPath,
    ], "YouTube");
  } else {
    await runFFmpeg([
      "-loop", "1", "-i", thumbnailPath,
      "-i", audioPath,
      "-vf", "scale=1280:720",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(duration), "-shortest", "-y", outputPath,
    ], "YouTube (imagem)");
  }
}

// ---------------------------------------------------------------------------
// Monta vídeo TikTok (portrait 1080x1920) com blur background
// ---------------------------------------------------------------------------

async function buildTiktokVideo(audioPath, videoClips, thumbnailPath, subtitleImages, outputPath, duration) {
  const hasClips = videoClips && videoClips.length > 0;

  if (hasClips) {
    const listPath = outputPath.replace(".mp4", "-list.txt");
    writeFileSync(listPath, videoClips.map((v) => `file '${v.localPath || v}'`).join("\n"));

    // Blur background filter: fundo desfocado + vídeo centralizado
    const blurFilter =
      "[0:v]split=2[fg][bg];" +
      "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:25[blurred];" +
      "[fg]scale=1080:1080:force_original_aspect_ratio=decrease[scaled];" +
      "[blurred][scaled]overlay=(W-w)/2:(H-h)/2[composed]";

    if (subtitleImages && subtitleImages.length > 0) {
      // Monta subtítulos em cima do blur background
      const yPos = Math.round(1920 * 0.83);
      let subChain = "";
      let prevLabel = "composed";
      subtitleImages.forEach((sub, i) => {
        const subIdx = 2 + i; // 0=video, 1=audio, 2+ = legendas
        const nextLabel = i === subtitleImages.length - 1 ? "out" : `s${i}`;
        subChain += `[${prevLabel}][${subIdx}:v]overlay=x=(W-w)/2:y=${yPos}:enable='between(t,${sub.start.toFixed(3)},${sub.end.toFixed(3)})'[${nextLabel}];`;
        prevLabel = nextLabel;
      });
      subChain = subChain.replace(/;$/, "");

      const fullFilter = `${blurFilter};${subChain}`;
      const extraInputs = [];
      subtitleImages.forEach((s) => extraInputs.push("-i", s.path));

      try {
        await runFFmpeg([
          "-f", "concat", "-safe", "0", "-i", listPath,
          "-i", audioPath,
          ...extraInputs,
          "-filter_complex", fullFilter,
          "-map", "[out]", "-map", "1:a",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23",
          "-c:a", "aac", "-b:a", "128k",
          "-shortest", "-y", outputPath,
        ], "TikTok+blur+legendas");
        return;
      } catch (e) {
        console.warn(`   ⚠️  TikTok com legendas falhou: ${e.message.slice(0, 100)}`);
      }
    }

    // Fallback: só blur sem legendas
    try {
      await runFFmpeg([
        "-f", "concat", "-safe", "0", "-i", listPath,
        "-i", audioPath,
        "-filter_complex", `${blurFilter};[composed]null[out]`,
        "-map", "[out]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest", "-y", outputPath,
      ], "TikTok+blur");
      return;
    } catch (e) {
      console.warn(`   ⚠️  Blur falhou, usando crop simples...`);
    }

    // Fallback final: crop simples
    await runFFmpeg([
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-i", audioPath,
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y", outputPath,
    ], "TikTok");
  } else {
    await runFFmpeg([
      "-loop", "1", "-i", thumbnailPath,
      "-i", audioPath,
      "-vf", "scale=1080:1920",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(duration), "-shortest", "-y", outputPath,
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

  // Gera legendas SRT + blocos com timestamps
  const srtPath = join(outputDir, "video", "subtitles.srt");
  const { srt, blocks } = generateSRT(scriptData.script, duration);
  writeFileSync(srtPath, srt, "utf-8");
  console.log(`   → Legendas: ${blocks.length} blocos`);

  // Gera imagens PNG de legenda para YouTube (1280px)
  const subTmpYT = join(outputDir, "video", "subs-yt");
  const subTmpTK = join(outputDir, "video", "subs-tk");

  let subtitleImagesYT = [];
  let subtitleImagesTK = [];

  try {
    subtitleImagesYT = await generateSubtitleImages(blocks, subTmpYT, 1280, false);
    subtitleImagesTK = await generateSubtitleImages(blocks, subTmpTK, 1080, true);
    console.log(`   → ${subtitleImagesYT.length} imagens de legenda geradas`);
  } catch (e) {
    console.warn(`   ⚠️  Falha ao gerar imagens de legenda: ${e.message}`);
  }

  const results = {};

  // YouTube (landscape 1280x720 — vídeo normal)
  const youtubePath = join(outputDir, "video", "youtube.mp4");
  try {
    await buildYoutubeVideo(audioPath, videoClips, thumbnailData?.youtube, subtitleImagesYT, youtubePath, duration);
    results.youtube = youtubePath;
    console.log(`   ✅ YouTube: ${youtubePath}`);
  } catch (e) {
    console.error(`   ❌ YouTube falhou: ${e.message}`);
  }

  // TikTok (portrait 1080x1920 — blur background + legendas)
  const tiktokPath = join(outputDir, "video", "tiktok.mp4");
  try {
    await buildTiktokVideo(audioPath, videoClips, thumbnailData?.tiktok, subtitleImagesTK, tiktokPath, duration);
    results.tiktok = tiktokPath;
    console.log(`   ✅ TikTok: ${tiktokPath}`);
  } catch (e) {
    console.error(`   ❌ TikTok falhou: ${e.message}`);
  }

  console.log("✅ [Video] Montagem concluída!");

  return {
    youtube: results.youtube || null,
    tiktok: results.tiktok || null,
    youtubeShorts: results.tiktok || null,
    outputDir: join(outputDir, "video"),
  };
}

// ---------------------------------------------------------------------------
// Execução direta
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("ℹ️  Módulo 6 (FFmpeg) carregado. Execute via pipeline/index.js");
}

/**
 * Módulo 6: Video — Montagem profissional com FFmpeg
 *
 * Features:
 * - Card de abertura (2s) com título
 * - Ken Burns suave nos clips
 * - Color grade dark/roxo
 * - Legendas palavra-por-palavra (estilo CapCut)
 * - CTA final (3s)
 * - Blur background no TikTok
 * - Música ambiente no YouTube (se disponível)
 */

import "dotenv/config";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS_DIR = join(__dirname, "../assets");

function stripEmojis(str) {
  return str.replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{27FF}|\u{2300}-\u{23FF}|\u{FE00}-\u{FEFF}|\u{1F000}-\u{1F02F}|\u{1F0A0}-\u{1F0FF}|\u{1F100}-\u{1F1FF}|\u{1F200}-\u{1F2FF}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA6F}|\u{1FA70}-\u{1FAFF}]/gu, "").trim();
}

function getFFmpegPath() {
  try { return execSync("which ffmpeg").toString().trim(); }
  catch { return "ffmpeg"; }
}

// ---------------------------------------------------------------------------
// Executa FFmpeg
// ---------------------------------------------------------------------------

function runFFmpeg(args, label = "") {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFFmpegPath();
    console.log(`   → FFmpeg [${label}]...`);
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg [${label}] falhou (${code}): ${stderr.slice(-600)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Gera SRT + blocos palavra-por-palavra
// ---------------------------------------------------------------------------

function generateWordBlocks(script, duration) {
  // Divide em palavras mantendo pontuação
  const words = script.trim().split(/\s+/).filter(Boolean);
  const timePerWord = duration / words.length;

  // Agrupa em chunks de 3 palavras (estilo CapCut)
  const chunks = [];
  for (let i = 0; i < words.length; i += 3) {
    const slice = words.slice(i, i + 3);
    const start = i * timePerWord;
    const end = Math.min((i + slice.length) * timePerWord, duration);
    chunks.push({ text: slice.join(" "), start, end });
  }

  // Gera SRT
  const fmt = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    const ms = Math.floor((s % 1) * 1000).toString().padStart(3, "0");
    return `${h}:${m}:${sec},${ms}`;
  };

  let srt = "";
  chunks.forEach((c, i) => {
    srt += `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n\n`;
  });

  return { blocks: chunks, srt };
}

// ---------------------------------------------------------------------------
// Gera imagens PNG de legenda (estilo CapCut — bold, contorno, fundo semi-transparente)
// ---------------------------------------------------------------------------

async function generateCaptionImages(blocks, tmpDir, videoWidth, isVertical) {
  mkdirSync(tmpDir, { recursive: true });
  // Legendas maiores e mais "chamativas" no formato vertical (TikTok/Shorts):
  // fonte maior + cor dourada em destaque (estilo CapCut/Reels), com
  // contorno grosso pra garantir leitura sobre qualquer fundo.
  const fontSize = isVertical ? 78 : 52;
  const boxPad = 20;
  const images = [];

  for (let i = 0; i < blocks.length; i++) {
    const { text, start, end } = blocks[i];
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Estima largura do texto (aprox)
    const estWidth = Math.min(escaped.length * (fontSize * 0.6), videoWidth - 80);
    const boxW = Math.max(estWidth + boxPad * 2, 200);
    const boxH = fontSize + boxPad * 2;

    // No formato vertical usamos um gradiente dourado vibrante (estilo
    // legenda "chamativa" de Shorts/Reels/TikTok); no horizontal mantemos
    // o branco clássico, mais discreto, sobre a faixa semitransparente.
    const fillValue = isVertical ? "url(#capGold)" : "white";
    const defs = isVertical
      ? `<defs>
        <linearGradient id="capGold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#fff7d6"/>
          <stop offset="45%" style="stop-color:#fde047"/>
          <stop offset="100%" style="stop-color:#f59e0b"/>
        </linearGradient>
      </defs>`
      : "";

    const svg = `<svg width="${boxW}" height="${boxH}" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="${boxW}" height="${boxH}" fill="rgba(0,0,0,0.7)" rx="12"/>
  <text
    x="${boxW / 2}" y="${boxH / 2}"
    font-family="Arial Black, Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="900"
    fill="${fillValue}"
    text-anchor="middle"
    dominant-baseline="middle"
    stroke="#000000"
    stroke-width="${isVertical ? 6 : 4}"
    paint-order="stroke"
  >${escaped}</text>
</svg>`;

    const imgPath = join(tmpDir, `cap-${String(i).padStart(5, "0")}.png`);
    await sharp(Buffer.from(svg)).png().toFile(imgPath);
    images.push({ path: imgPath, start, end, width: boxW, height: boxH });
  }

  return images;
}

// ---------------------------------------------------------------------------
// Gera card de ABERTURA (Sharp SVG → PNG)
// ---------------------------------------------------------------------------

async function generateOpeningCard(title, outputDir, w, h) {
  const escaped = stripEmojis(title).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const words = escaped.split(" ");
  const lines = [];
  let cur = "";
  const fontSize = h > 900 ? 100 : 80;
  // Calcula o nº de caracteres por linha com base na largura real do canvas
  // e no tamanho da fonte (evita texto cortado nas bordas — ex: TikTok
  // vertical é mais estreito, mas usava o mesmo limite de caracteres do
  // YouTube com fonte maior, o que estourava a largura e cortava o título).
  const maxChars = Math.floor((w - 100) / (fontSize * 0.62));
  for (const word of words) {
    if ((cur + " " + word).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = word;
    } else {
      cur = (cur + " " + word).trim();
    }
  }
  if (cur) lines.push(cur.trim());

  const lineH = h > 900 ? 110 : 90;
  const startY = h / 2 - (lines.length * lineH) / 2;

  const textEls = lines.map((l, i) => `
    <text x="${w/2}" y="${startY + i * lineH}"
      font-family="Arial Black, Arial, sans-serif"
      font-size="${fontSize}" font-weight="900"
      fill="white" text-anchor="middle" dominant-baseline="middle"
      stroke="black" stroke-width="4" paint-order="stroke"
      filter="url(#shadow)"
    >${l}</text>`).join("");

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a1a"/>
      <stop offset="50%" style="stop-color:#1a0a2e"/>
      <stop offset="100%" style="stop-color:#0a0a0f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6b21a8"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.9"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${w/2}" cy="${h/2}" rx="${w*0.4}" ry="${h*0.3}" fill="#4c1d95" opacity="0.4"/>
  <!-- Olho -->
  <ellipse cx="${w/2}" cy="${h > 900 ? 280 : 120}" rx="${h > 900 ? 100 : 65}" ry="${h > 900 ? 60 : 38}"
    fill="none" stroke="#a855f7" stroke-width="${h > 900 ? 5 : 3}" opacity="0.9"/>
  <circle cx="${w/2}" cy="${h > 900 ? 280 : 120}" r="${h > 900 ? 32 : 20}" fill="#a855f7"/>
  <circle cx="${w/2}" cy="${h > 900 ? 280 : 120}" r="${h > 900 ? 14 : 9}" fill="#fbbf24"/>
  ${textEls}
  <rect x="0" y="${h - 10}" width="${w}" height="10" fill="url(#accent)"/>
  <text x="${w/2}" y="${h - 40}"
    font-family="Arial, sans-serif" font-size="${h > 900 ? 36 : 28}"
    fill="#a855f7" text-anchor="middle" dominant-baseline="middle" font-weight="bold"
  >CODEX MENTAL</text>
</svg>`;

  const path = join(outputDir, `opening-${w}x${h}.png`);
  await sharp(Buffer.from(svg)).png().toFile(path);
  return path;
}

// ---------------------------------------------------------------------------
// Gera card de CTA final
// ---------------------------------------------------------------------------

async function generateCTACard(outputDir, w, h) {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a1a"/>
      <stop offset="100%" style="stop-color:#1a0a2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6b21a8"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${w/2}" cy="${h/2}" rx="${w*0.45}" ry="${h*0.35}" fill="#4c1d95" opacity="0.3"/>

  <text x="${w/2}" y="${h/2 - (h > 900 ? 80 : 50)}"
    font-family="Arial Black, Arial, sans-serif"
    font-size="${h > 900 ? 90 : 68}" font-weight="900"
    fill="white" text-anchor="middle" dominant-baseline="middle"
    stroke="black" stroke-width="4" paint-order="stroke"
  >SIGA PARA MAIS</text>

  <rect x="${w/2 - (h > 900 ? 280 : 220)}" y="${h/2 + (h > 900 ? 20 : 10)}"
    width="${h > 900 ? 560 : 440}" height="${h > 900 ? 90 : 70}" rx="45" fill="url(#accent)"/>
  <text x="${w/2}" y="${h/2 + (h > 900 ? 65 : 47)}"
    font-family="Arial Black, Arial, sans-serif"
    font-size="${h > 900 ? 52 : 40}" font-weight="900"
    fill="white" text-anchor="middle" dominant-baseline="middle"
  >@codexmentalbr</text>

  <rect x="0" y="${h - 10}" width="${w}" height="10" fill="url(#accent)"/>
</svg>`;

  const path = join(outputDir, `cta-${w}x${h}.png`);
  await sharp(Buffer.from(svg)).png().toFile(path);
  return path;
}

// ---------------------------------------------------------------------------
// Prepara clips com color grade dark/roxo
// ---------------------------------------------------------------------------

async function prepareClips(videoClips, tmpDir, w, h, isTikTok) {
  mkdirSync(tmpDir, { recursive: true });
  const prepared = [];

  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const src = clip.localPath || clip;
    const out = join(tmpDir, `clip-${i}.mp4`);

    // Color grade: contraste alto, saturação reduzida, tom frio/roxo
    const colorGrade =
      "eq=contrast=1.15:brightness=0.02:saturation=0.75," +
      "colorchannelmixer=rr=0.85:gg=0.82:bb=1.08";

    let scaleFilter;
    if (isTikTok) {
      // Blur background para TikTok
      scaleFilter =
        `[0:v]split=2[fg][bg];` +
        `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=25:25,${colorGrade}[blurred];` +
        `[fg]scale=${w}:${Math.round(w * 0.75)}:force_original_aspect_ratio=decrease,${colorGrade}[scaled];` +
        `[blurred][scaled]overlay=(W-w)/2:(H-h)/2[out]`;
    } else {
      scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${colorGrade}`;
    }

    try {
      if (isTikTok) {
        await runFFmpeg([
          "-i", src,
          "-filter_complex", scaleFilter,
          "-map", "[out]", "-an",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-t", "10", "-y", out,
        ], `clip${i}-tiktok`);
      } else {
        await runFFmpeg([
          "-i", src,
          "-vf", scaleFilter,
          "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-t", "10", "-y", out,
        ], `clip${i}-yt`);
      }
      prepared.push(out);
    } catch (e) {
      console.warn(`   ⚠️  Clip ${i} falhou: ${e.message.slice(0, 80)}`);
      // Usa original sem grade
      prepared.push(src);
    }
  }
  return prepared;
}

// ---------------------------------------------------------------------------
// Converte imagem estática em vídeo curto
// ---------------------------------------------------------------------------

async function imageToVideo(imgPath, durationSec, w, h, outPath) {
  await runFFmpeg([
    "-loop", "1", "-i", imgPath,
    "-vf", `scale=${w}:${h},format=yuv420p`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-t", String(durationSec), "-an", "-y", outPath,
  ], "img2vid");
}

// ---------------------------------------------------------------------------
// Monta vídeo final com legendas overlay
// ---------------------------------------------------------------------------

async function buildFinalVideo(videoListPath, audioPath, captionImages, outputPath, musicPath, label, isVertical = false) {
  const hasCaptions = captionImages && captionImages.length > 0;
  const hasMusic = musicPath && existsSync(musicPath);

  // Inputs: 0=video, 1=narração, [2=música], [2+N=legendas]
  const inputs = [
    "-f", "concat", "-safe", "0", "-i", videoListPath,
    "-i", audioPath,
  ];

  if (hasMusic) inputs.push("-i", musicPath);

  const captionInputs = [];
  if (hasCaptions) {
    // IMPORTANTE: usar -loop 1 -framerate 25 para que cada legenda vire um
    // stream de vídeo contínuo. Sem isso, o ffmpeg só fornece UM frame (em
    // t=0) para cada imagem — depois que esse frame é consumido no início
    // do encode, o overlay não tem mais nada pra compor nas janelas
    // enable=between(t,...) que ocorrem mais tarde, e a legenda some.
    captionImages.forEach((c) => captionInputs.push("-loop", "1", "-framerate", "25", "-i", c.path));
  }

  const musicIdx = hasMusic ? 2 : null;
  const capStartIdx = hasMusic ? 3 : 2;

  // Monta audio mix
  let audioFilter = "";
  let audioMap = "1:a";
  if (hasMusic) {
    audioFilter = `[1:a]volume=1.0[narr];[${musicIdx}:a]volume=0.15[music];[narr][music]amix=inputs=2:duration=first[aout]`;
    audioMap = "[aout]";
  }

  // Monta cadeia de legendas
  if (hasCaptions) {
    let chain = audioFilter ? "" : "";
    // Normaliza o formato de pixel do vídeo base ANTES da cadeia de overlays.
    // Sem isso, o ffmpeg "reconfigura" o filtro overlay quando o formato muda
    // entre os segmentos concatenados (ex: abertura em yuv420p → clipes em
    // yuv444p), e o overlay para de compor a partir daí — legendas somem.
    const filterParts = audioFilter ? [audioFilter] : [];
    filterParts.push("[0:v]format=yuv420p[vbase]");
    let prevLabel = "vbase";

    // No formato vertical (TikTok/Shorts) o usuário pediu legendas mais
    // pra cima — em telas de celular a parte de baixo costuma ficar coberta
    // pela barra de interações/descrição, então subimos a faixa de overlay.
    const captionY = isVertical ? "H*0.70" : "H*0.84";

    captionImages.forEach((cap, i) => {
      const idx = capStartIdx + i;
      const nextLabel = i === captionImages.length - 1 ? "vout" : `vcap${i}`;
      const enable = `between(t,${cap.start.toFixed(3)},${cap.end.toFixed(3)})`;
      filterParts.push(
        `[${prevLabel}][${idx}:v]overlay=x=(W-w)/2:y=${captionY}:enable='${enable}':shortest=0[${nextLabel}]`
      );
      prevLabel = nextLabel;
    });

    const filterComplex = filterParts.join(";");

    try {
      await runFFmpeg([
        ...inputs, ...captionInputs,
        "-filter_complex", filterComplex,
        "-map", "[vout]", "-map", audioMap,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest", "-y", outputPath,
      ], label + "+legendas");
      return;
    } catch (e) {
      console.warn(`   ⚠️  Legendas overlay falhou, continuando sem:\n${e.message.slice(0, 400)}`);
    }
  }

  // Fallback: sem legendas
  const fallbackArgs = [...inputs];
  if (hasMusic) {
    await runFFmpeg([
      ...fallbackArgs,
      "-filter_complex", `[1:a]volume=1.0[narr];[${musicIdx}:a]volume=0.15[music];[narr][music]amix=inputs=2:duration=first[aout]`,
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y", outputPath,
    ], label);
  } else {
    await runFFmpeg([
      ...fallbackArgs,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-y", outputPath,
    ], label);
  }
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function assembleVideo(scriptData, voiceData, mediaData, thumbnailData, outputDir) {
  mkdirSync(join(outputDir, "video"), { recursive: true });
  const tmpDir = join(outputDir, "video", "tmp");
  mkdirSync(tmpDir, { recursive: true });

  console.log("🎞️  [Video] Montando vídeo com FFmpeg...");

  const audioPath = voiceData.audioPath;
  const duration = voiceData.duration || 60;
  const videoClips = mediaData?.videos || [];
  const title = stripEmojis(scriptData.title?.youtube || scriptData.title || "Codex Mental");
  const tiktokTitle = stripEmojis(scriptData.title?.tiktok || title);

  // Música ambiente (YouTube only) — coloca um arquivo em assets/music.mp3
  const musicPath = join(ASSETS_DIR, "music.mp3");

  console.log(`   → Duração do áudio: ${duration.toFixed ? duration.toFixed(1) : duration}s`);

  // Gera legendas palavra-por-palavra
  const { blocks, srt } = generateWordBlocks(scriptData.script, duration);
  writeFileSync(join(outputDir, "video", "subtitles.srt"), srt, "utf-8");
  console.log(`   → Legendas: ${blocks.length} blocos (palavra-por-palavra)`);

  const results = {};

  // ── YouTube (1280x720) ────────────────────────────────────────────────────
  console.log("\n   📺 Montando YouTube...");

  const ytTmp = join(tmpDir, "yt");
  mkdirSync(ytTmp, { recursive: true });
  // Usa a THUMBNAIL real (com foto de fundo) como card de abertura, em vez
  // do card genérico em SVG — assim o vídeo abre já com a mesma arte que o
  // usuário vê na thumbnail (ela já vem no tamanho exato 1280x720).
  const openingYT = (thumbnailData?.youtube && existsSync(thumbnailData.youtube))
    ? thumbnailData.youtube
    : await generateOpeningCard(title, ytTmp, 1280, 720);
  const ctaYT = await generateCTACard(ytTmp, 1280, 720);
  const openingVideoYT = join(ytTmp, "opening.mp4");
  const ctaVideoYT = join(ytTmp, "cta.mp4");
  await imageToVideo(openingYT, 2, 1280, 720, openingVideoYT);
  await imageToVideo(ctaYT, 3, 1280, 720, ctaVideoYT);

  let ytClips = [];
  if (videoClips.length > 0) {
    ytClips = await prepareClips(videoClips, join(ytTmp, "clips"), 1280, 720, false);
  }

  // Monta lista: abertura + clips + CTA
  const ytListPath = join(ytTmp, "list.txt");
  const ytList = [
    `file '${openingVideoYT}'`,
    ...ytClips.map(c => `file '${c}'`),
    `file '${ctaVideoYT}'`,
  ].join("\n");
  writeFileSync(ytListPath, ytList);

  // Gera legendas PNG para YouTube
  const ytCapDir = join(ytTmp, "captions");
  let ytCaptions = [];
  try {
    // A narração é mapeada direto (audioMap = "1:a"), sem delay — ou seja,
    // ela começa a tocar em t=0 do vídeo final (durante o card de abertura),
    // não depois dele. Por isso as legendas usam os tempos originais dos
    // blocos, sem nenhum offset — caso contrário ficam atrasadas em relação
    // ao áudio (era o que o usuário estava percebendo: +2s de atraso).
    ytCaptions = await generateCaptionImages(blocks, ytCapDir, 1280, false);
    console.log(`   → ${ytCaptions.length} imagens de legenda (YouTube)`);
  } catch (e) {
    console.warn(`   ⚠️  Legendas YT falhou: ${e.message}`);
  }

  const youtubePath = join(outputDir, "video", "youtube.mp4");
  try {
    await buildFinalVideo(ytListPath, audioPath, ytCaptions, youtubePath, musicPath, "YouTube", false);
    results.youtube = youtubePath;
    console.log(`   ✅ YouTube: ${youtubePath}`);
  } catch (e) {
    console.error(`   ❌ YouTube falhou: ${e.message}`);
  }

  // ── TikTok (1080x1920) ────────────────────────────────────────────────────
  console.log("\n   📱 Montando TikTok...");

  const tkTmp = join(tmpDir, "tk");
  mkdirSync(tkTmp, { recursive: true });
  const openingTK = (thumbnailData?.tiktok && existsSync(thumbnailData.tiktok))
    ? thumbnailData.tiktok
    : await generateOpeningCard(tiktokTitle, tkTmp, 1080, 1920);
  const ctaTK = await generateCTACard(tkTmp, 1080, 1920);
  const openingVideoTK = join(tkTmp, "opening.mp4");
  const ctaVideoTK = join(tkTmp, "cta.mp4");
  await imageToVideo(openingTK, 2, 1080, 1920, openingVideoTK);
  await imageToVideo(ctaTK, 3, 1080, 1920, ctaVideoTK);

  let tkClips = [];
  if (videoClips.length > 0) {
    tkClips = await prepareClips(videoClips, join(tkTmp, "clips"), 1080, 1920, true);
  }

  const tkListPath = join(tkTmp, "list.txt");
  const tkList = [
    `file '${openingVideoTK}'`,
    ...tkClips.map(c => `file '${c}'`),
    `file '${ctaVideoTK}'`,
  ].join("\n");
  writeFileSync(tkListPath, tkList);

  const tkCapDir = join(tkTmp, "captions");
  let tkCaptions = [];
  try {
    // Mesmo motivo do YouTube: a narração começa em t=0 do vídeo final
    // (sem delay), então as legendas usam os tempos originais sem offset.
    tkCaptions = await generateCaptionImages(blocks, tkCapDir, 1080, true);
    console.log(`   → ${tkCaptions.length} imagens de legenda (TikTok)`);
  } catch (e) {
    console.warn(`   ⚠️  Legendas TK falhou: ${e.message}`);
  }

  const tiktokPath = join(outputDir, "video", "tiktok.mp4");
  try {
    // TikTok sem música (vai adicionar som nativo no app)
    await buildFinalVideo(tkListPath, audioPath, tkCaptions, tiktokPath, null, "TikTok", true);
    results.tiktok = tiktokPath;
    console.log(`   ✅ TikTok: ${tiktokPath}`);
  } catch (e) {
    console.error(`   ❌ TikTok falhou: ${e.message}`);
  }

  console.log("\n✅ [Video] Montagem concluída!");

  return {
    youtube: results.youtube || null,
    tiktok: results.tiktok || null,
    youtubeShorts: results.tiktok || null,
    outputDir: join(outputDir, "video"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("ℹ️  Execute via: node pipeline/index.js");
}

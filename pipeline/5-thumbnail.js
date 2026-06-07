/**
 * Módulo 5: Thumbnail — Geração local com Sharp (gratuito)
 *
 * Cria thumbnails com estética dark/misteriosa usando
 * Sharp + Canvas, sem custo de API externa.
 */

import "dotenv/config";
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers de FFmpeg — usados pra extrair um frame real de um clip como
// "fundo de foto verdadeira" da thumbnail (opção 2: thumb com imagem real).
// ---------------------------------------------------------------------------

function getFFmpegPath() {
  try { return execSync("which ffmpeg").toString().trim(); }
  catch { return "ffmpeg"; }
}

function extractFrame(videoPath, timeSec, outPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFFmpegPath();
    const proc = spawn(ffmpeg, [
      "-ss", String(timeSec), "-i", videoPath,
      "-frames:v", "1", "-q:v", "2", "-y", outPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0 && existsSync(outPath)) resolve();
      else reject(new Error(`FFmpeg [extractFrame] falhou (${code}): ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Tenta obter uma imagem de fundo "real" (foto/frame de vídeo) a partir dos
 * dados de mídia já baixados — sem custo de API. Prioriza um frame do meio
 * de algum clip (geralmente mais "carregado"/interessante visualmente) e cai
 * pro background.jpg se não houver clips.
 */
async function getRealPhotoBackground(mediaData, outputDir) {
  if (!mediaData) return null;
  const tmpDir = join(outputDir, "thumbnails", "_tmp");
  mkdirSync(tmpDir, { recursive: true });

  if (Array.isArray(mediaData.videos) && mediaData.videos.length) {
    const clip = mediaData.videos[Math.floor(mediaData.videos.length / 2)] || mediaData.videos[0];
    if (clip?.localPath && existsSync(clip.localPath)) {
      const framePath = join(tmpDir, "real-frame.jpg");
      try {
        await extractFrame(clip.localPath, 1.5, framePath);
        if (existsSync(framePath)) return framePath;
      } catch {
        // se falhar, tenta o background.jpg como fallback
      }
    }
  }

  if (mediaData.backgroundImage && existsSync(mediaData.backgroundImage)) {
    return mediaData.backgroundImage;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Paleta de cores dark — estética Codex Mental
// ---------------------------------------------------------------------------

const PALETTE = {
  bg: "#0a0a0f",
  purple: "#6b21a8",
  purpleLight: "#a855f7",
  gold: "#fbbf24",
  white: "#ffffff",
  overlay: "rgba(10,10,15,0.75)",
};

// ---------------------------------------------------------------------------
// Gera SVG base para thumbnail
// ---------------------------------------------------------------------------

// Detecta se a primeira "palavra" do título é um número/destaque
// (ex: "3 Sinais...") pra realçar em dourado e em tamanho maior —
// truque clássico de thumbnail que chama atenção e aumenta CTR.
function splitHighlight(title) {
  const words = title.split(" ");
  const first = words[0];
  if (/^\d+$/.test(first) || /^[A-ZÀ-Ú]{2,}$/.test(first)) {
    return { highlight: first, rest: words.slice(1).join(" ") };
  }
  return { highlight: null, rest: title };
}

function wrapLines(text, maxChars) {
  const words = text.split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

// Defs compartilhados — vinheta, grain (textura de filme), glows em camadas
function sharedDefs(w, h) {
  return `
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="9" flood-color="#000000" flood-opacity="0.85"/>
    </filter>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="noise"/>
      <feColorMatrix in="noise" type="matrix"
        values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/>
      <feComposite operator="over" in2="SourceGraphic"/>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.65"/>
    </radialGradient>
    <radialGradient id="glowCore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#6b21a8" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#6b21a8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0c0a16"/>
      <stop offset="45%" style="stop-color:#1c0f33"/>
      <stop offset="100%" style="stop-color:#08070d"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6b21a8"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#fde68a"/>
      <stop offset="55%" style="stop-color:#fbbf24"/>
      <stop offset="100%" style="stop-color:#d97706"/>
    </linearGradient>
  `;
}

function buildYoutubeSVG(title, subtitle, opts = {}) {
  const { transparent = false } = opts;
  const w = 1280;
  const h = 720;

  const { highlight, rest } = splitHighlight(title);
  const lines = wrapLines(rest, 22);
  const lineHeight = 84;
  const hlBlock = highlight ? 130 : 0;
  const totalHeight = lines.length * lineHeight + hlBlock;
  let cursorY = h / 2 - totalHeight / 2 + 30;

  let highlightEl = "";
  if (highlight) {
    highlightEl = `
    <text x="${w / 2}" y="${cursorY}"
      font-family="Arial Black, Arial, sans-serif" font-size="120" font-weight="900"
      fill="url(#goldGrad)" text-anchor="middle" dominant-baseline="middle"
      stroke="#3a1d00" stroke-width="2" paint-order="stroke"
      filter="url(#shadow)"
    >${highlight}</text>`;
    cursorY += hlBlock;
  }

  const textElements = lines
    .map((line, i) => `
    <text x="${w / 2}" y="${cursorY + i * lineHeight}"
      font-family="Arial Black, Arial, sans-serif" font-size="74" font-weight="900"
      fill="white" text-anchor="middle" dominant-baseline="middle"
      stroke="#000000" stroke-width="2" paint-order="stroke"
      filter="url(#shadow)"
    >${line}</text>`)
    .join("");

  // Quando "transparent" (usado pra compor sobre uma foto/frame real), pula
  // o fundo gradiente/glow/grain — eles ficariam por cima da foto e a
  // esconderiam. A foto entra por baixo via Sharp; aqui só desenhamos a
  // "decoração" (moldura, ícone, texto, selo, vinheta) num PNG transparente.
  const bgLayers = transparent ? "" : `
  <!-- Fundo em camadas: gradiente base + glow central + vinheta -->
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.22"/>
  <ellipse cx="${w * 0.32}" cy="${h * 0.4}" rx="480" ry="360" fill="url(#glowCore)"/>
  <ellipse cx="${w * 0.74}" cy="${h * 0.7}" rx="380" ry="300" fill="#7c3aed" opacity="0.14"/>`;

  // Sobre uma foto real, um degradê escuro de baixo pra cima garante
  // legibilidade do texto/selo sem precisar escurecer a foto inteira.
  const legibilityScrim = transparent ? `
  <linearGradient id="scrim" x1="0%" y1="100%" x2="0%" y2="0%">
    <stop offset="0%" style="stop-color:#000000;stop-opacity:0.85"/>
    <stop offset="40%" style="stop-color:#000000;stop-opacity:0.35"/>
    <stop offset="75%" style="stop-color:#000000;stop-opacity:0"/>
  </linearGradient>` : "";

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>${sharedDefs(w, h)}${legibilityScrim}</defs>
${bgLayers}
  ${transparent ? `<rect width="${w}" height="${h}" fill="url(#scrim)"/>` : ""}

  <!-- Linhas/raios diagonais sutis -->
  <g opacity="0.10" stroke="#a855f7" stroke-width="2">
    <line x1="-50" y1="${h * 0.15}" x2="${w * 0.55}" y2="-50"/>
    <line x1="-50" y1="${h * 0.35}" x2="${w * 0.75}" y2="-50"/>
    <line x1="${w * 0.55}" y1="${h + 50}" x2="${w + 50}" y2="${h * 0.45}"/>
  </g>

  <!-- Moldura fina com gradiente -->
  <rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="18"
    fill="none" stroke="url(#accent)" stroke-width="2.5" opacity="0.55"/>

  <!-- Linhas de destaque superior/inferior -->
  <line x1="0" y1="${h - 6}" x2="${w}" y2="${h - 6}" stroke="url(#accent)" stroke-width="6"/>
  <line x1="0" y1="6" x2="${w}" y2="6" stroke="url(#accent)" stroke-width="3" opacity="0.45"/>

  <!-- Ícone de olho (símbolo do canal), com glow -->
  <ellipse cx="${w / 2}" cy="118" rx="58" ry="34" fill="none" stroke="#a855f7" stroke-width="3" opacity="0.85" filter="url(#softShadow)"/>
  <circle cx="${w / 2}" cy="118" r="17" fill="#a855f7" opacity="0.95"/>
  <circle cx="${w / 2}" cy="118" r="7" fill="#fbbf24"/>

  <!-- Título / palavra-chave em destaque -->
  ${highlightEl}
  ${textElements}

  <!-- Selo / CTA inferior com brilho -->
  <rect x="${w / 2 - 215}" y="${h - 96}" width="430" height="52" rx="26"
    fill="url(#accent)" opacity="0.95" filter="url(#softShadow)"/>
  <rect x="${w / 2 - 215}" y="${h - 96}" width="430" height="22" rx="26"
    fill="#ffffff" opacity="0.12"/>
  <text x="${w / 2}" y="${h - 70}"
    font-family="Arial, sans-serif" font-size="25" letter-spacing="2"
    fill="white" text-anchor="middle" dominant-baseline="middle" font-weight="bold"
  >CODEX MENTAL</text>

  <!-- Partículas decorativas -->
  <circle cx="110" cy="110" r="4" fill="#a855f7" opacity="0.55"/>
  <circle cx="75" cy="195" r="2" fill="#fbbf24" opacity="0.5"/>
  <circle cx="1170" cy="145" r="4" fill="#a855f7" opacity="0.55"/>
  <circle cx="1205" cy="75" r="2" fill="#fbbf24" opacity="0.5"/>
  <circle cx="190" cy="610" r="3" fill="#7c3aed" opacity="0.4"/>
  <circle cx="1095" cy="585" r="3" fill="#7c3aed" opacity="0.4"/>

  <!-- Vinheta + grain por cima de tudo, pra dar acabamento "cinematográfico" -->
  <rect width="${w}" height="${h}" fill="url(#vignette)"/>
</svg>`;
}

function buildTiktokSVG(title, opts = {}) {
  const { transparent = false } = opts;
  const w = 1080;
  const h = 1920;

  const { highlight, rest } = splitHighlight(title);
  const lines = wrapLines(rest, 16);
  const lineHeight = 104;
  const hlBlock = highlight ? 160 : 0;
  const totalHeight = lines.length * lineHeight + hlBlock;
  let cursorY = h / 2 - totalHeight / 2 + 20;

  let highlightEl = "";
  if (highlight) {
    highlightEl = `
    <text x="${w / 2}" y="${cursorY}"
      font-family="Arial Black, Arial, sans-serif" font-size="150" font-weight="900"
      fill="url(#goldGrad)" text-anchor="middle" dominant-baseline="middle"
      stroke="#3a1d00" stroke-width="2.5" paint-order="stroke"
      filter="url(#shadow)"
    >${highlight}</text>`;
    cursorY += hlBlock;
  }

  const textElements = lines
    .map((line, i) => `
    <text x="${w / 2}" y="${cursorY + i * lineHeight}"
      font-family="Arial Black, Arial, sans-serif" font-size="80" font-weight="900"
      fill="white" text-anchor="middle" dominant-baseline="middle"
      stroke="#000000" stroke-width="2.5" paint-order="stroke"
      filter="url(#shadow)"
    >${line}</text>`)
    .join("");

  const bgLayers = transparent ? "" : `
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.22"/>
  <ellipse cx="${w * 0.5}" cy="${h * 0.38}" rx="430" ry="520" fill="url(#glowCore)"/>
  <ellipse cx="${w * 0.5}" cy="${h * 0.78}" rx="360" ry="320" fill="#7c3aed" opacity="0.16"/>`;

  const legibilityScrim = transparent ? `
  <linearGradient id="scrim" x1="0%" y1="100%" x2="0%" y2="0%">
    <stop offset="0%" style="stop-color:#000000;stop-opacity:0.85"/>
    <stop offset="35%" style="stop-color:#000000;stop-opacity:0.4"/>
    <stop offset="70%" style="stop-color:#000000;stop-opacity:0.05"/>
  </linearGradient>` : "";

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>${sharedDefs(w, h)}${legibilityScrim}</defs>
${bgLayers}
  ${transparent ? `<rect width="${w}" height="${h}" fill="url(#scrim)"/>` : ""}

  <!-- Raios diagonais sutis -->
  <g opacity="0.10" stroke="#a855f7" stroke-width="2">
    <line x1="-80" y1="${h * 0.18}" x2="${w * 0.7}" y2="-80"/>
    <line x1="-80" y1="${h * 0.32}" x2="${w + 80}" y2="${h * 0.05}"/>
    <line x1="${w * 0.2}" y1="${h + 80}" x2="${w + 80}" y2="${h * 0.62}"/>
  </g>

  <!-- Moldura fina -->
  <rect x="16" y="16" width="${w - 32}" height="${h - 32}" rx="22"
    fill="none" stroke="url(#accent)" stroke-width="3" opacity="0.5"/>

  <!-- Olho no topo, com glow -->
  <ellipse cx="${w / 2}" cy="290" rx="88" ry="54" fill="none" stroke="#a855f7" stroke-width="4" opacity="0.9" filter="url(#softShadow)"/>
  <circle cx="${w / 2}" cy="290" r="27" fill="#a855f7"/>
  <circle cx="${w / 2}" cy="290" r="11" fill="#fbbf24"/>

  <!-- Título / palavra-chave em destaque -->
  ${highlightEl}
  ${textElements}

  <!-- Badge inferior com brilho -->
  <rect x="${w / 2 - 225}" y="${h - 210}" width="450" height="74" rx="37" fill="url(#accent)" opacity="0.95" filter="url(#softShadow)"/>
  <rect x="${w / 2 - 225}" y="${h - 210}" width="450" height="30" rx="37" fill="#ffffff" opacity="0.12"/>
  <text x="${w / 2}" y="${h - 173}"
    font-family="Arial, sans-serif" font-size="33" letter-spacing="1.5" fill="white"
    text-anchor="middle" dominant-baseline="middle" font-weight="bold"
  >@codexmentalbr</text>

  <line x1="0" y1="${h - 14}" x2="${w}" y2="${h - 14}" stroke="url(#accent)" stroke-width="14"/>

  <!-- Vinheta + grain -->
  <rect width="${w}" height="${h}" fill="url(#vignette)"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

function stripEmojis(str) {
  return str.replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{27FF}|\u{2300}-\u{23FF}|\u{FE00}-\u{FEFF}|\u{1F000}-\u{1F02F}|\u{1F0A0}-\u{1F0FF}|\u{1F100}-\u{1F1FF}|\u{1F200}-\u{1F2FF}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA6F}|\u{1FA70}-\u{1FAFF}]/gu, "").trim();
}

/**
 * Monta uma thumbnail compondo uma FOTO/FRAME REAL como fundo (extraída do
 * próprio footage já baixado, sem custo de API) com a camada de design
 * (texto, moldura, selo, vinheta) por cima — gerada como PNG transparente.
 *
 * Pipeline: foto -> cover-resize pro tamanho alvo -> color-grade (escurece +
 * tinge de roxo, pra casar com a paleta do canal) -> composite com a
 * camada de overlay (SVG transparente renderizado em PNG via Sharp).
 */
async function composeRealPhotoThumb(photoPath, overlaySvg, w, h, outPath) {
  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();

  const photoBuf = await sharp(photoPath)
    .resize(w, h, { fit: "cover", position: "attention" })
    // Color grading leve: escurece e aproxima da paleta roxa/dark do canal,
    // sem deixar a foto irreconhecível.
    .modulate({ brightness: 0.78, saturation: 0.85 })
    .tint({ r: 130, g: 90, b: 200 })
    .toBuffer();

  await sharp(photoBuf)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .png()
    .toFile(outPath);
}

export async function generateThumbnail(topicData, scriptData, outputDir, mediaData = null) {
  mkdirSync(join(outputDir, "thumbnails"), { recursive: true });

  console.log("🖼️  [Thumbnail] Gerando thumbnails com Sharp...");

  const title = stripEmojis(scriptData.title?.youtube || topicData.topic || "Codex Mental");
  const tiktokTitle = stripEmojis(scriptData.title?.tiktok || title);

  const results = {};

  // Tenta extrair uma foto/frame real do footage já baixado (de graça).
  let photoPath = null;
  try {
    photoPath = await getRealPhotoBackground(mediaData, outputDir);
  } catch (e) {
    console.warn(`   ⚠️  Não foi possível extrair foto real de fundo: ${e.message.slice(0, 200)}`);
  }

  // YouTube (1280x720)
  const youtubePath = join(outputDir, "thumbnails", "youtube.png");
  if (photoPath) {
    const overlaySvg = buildYoutubeSVG(title, "Codex Mental", { transparent: true });
    await composeRealPhotoThumb(photoPath, overlaySvg, 1280, 720, youtubePath);
    console.log("   ✅ YouTube thumbnail gerada com foto real de fundo (1280x720)");
  } else {
    const youtubeSvg = buildYoutubeSVG(title, "Codex Mental");
    await sharp(Buffer.from(youtubeSvg)).png().toFile(youtubePath);
    console.log("   ✅ YouTube thumbnail gerada (1280x720)");
  }
  results.youtube = youtubePath;

  // TikTok (1080x1920)
  const tiktokPath = join(outputDir, "thumbnails", "tiktok.png");
  if (photoPath) {
    const overlaySvg = buildTiktokSVG(tiktokTitle, { transparent: true });
    await composeRealPhotoThumb(photoPath, overlaySvg, 1080, 1920, tiktokPath);
    console.log("   ✅ TikTok thumbnail gerada com foto real de fundo (1080x1920)");
  } else {
    const tiktokSvg = buildTiktokSVG(tiktokTitle);
    await sharp(Buffer.from(tiktokSvg)).png().toFile(tiktokPath);
    console.log("   ✅ TikTok thumbnail gerada (1080x1920)");
  }
  results.tiktok = tiktokPath;

  console.log(`✅ [Thumbnail] Salvas em ${outputDir}/thumbnails/`);

  return { youtube: results.youtube, tiktok: results.tiktok };
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/5-thumbnail.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const testTopic = { topic: "3 Sinais Que Alguém Está Mentindo Para Você" };
  const testScript = { title: { youtube: "3 Sinais Que Alguém Está Mentindo Para Você", tiktok: "3 Sinais de Mentira" } };
  const outputDir = join(__dirname, "../output/test-thumbnail");

  generateThumbnail(testTopic, testScript, outputDir)
    .then((r) => console.log("✅ Thumbnails geradas:", r))
    .catch((e) => { console.error("❌", e.message); process.exit(1); });
}

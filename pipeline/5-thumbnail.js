/**
 * Módulo 5: Thumbnail — Geração local com Sharp (gratuito)
 *
 * Cria thumbnails com estética dark/misteriosa usando
 * Sharp + Canvas, sem custo de API externa.
 */

import "dotenv/config";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function buildYoutubeSVG(title, subtitle) {
  const w = 1280;
  const h = 720;

  // Quebra o título em linhas (máx 22 chars por linha)
  const words = title.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > 22) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());

  const lineHeight = 90;
  const totalHeight = lines.length * lineHeight;
  const startY = h / 2 - totalHeight / 2 + 40;

  const textElements = lines
    .map(
      (line, i) => `
    <text
      x="${w / 2}"
      y="${startY + i * lineHeight}"
      font-family="Arial Black, Arial, sans-serif"
      font-size="82"
      font-weight="900"
      fill="white"
      text-anchor="middle"
      dominant-baseline="middle"
      filter="url(#shadow)"
    >${line}</text>
  `
    )
    .join("");

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.9"/>
    </filter>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a1a"/>
      <stop offset="50%" style="stop-color:#1a0a2e"/>
      <stop offset="100%" style="stop-color:#0a0a0f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6b21a8"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${w}" height="${h}" fill="url(#bg)"/>

  <!-- Efeito de luz roxa no centro -->
  <ellipse cx="${w / 2}" cy="${h / 2}" rx="500" ry="300" fill="#4c1d95" opacity="0.3"/>
  <ellipse cx="${w / 2}" cy="${h / 2}" rx="250" ry="150" fill="#7c3aed" opacity="0.2"/>

  <!-- Linhas decorativas -->
  <line x1="0" y1="${h - 8}" x2="${w}" y2="${h - 8}" stroke="url(#accent)" stroke-width="8"/>
  <line x1="0" y1="8" x2="${w}" y2="8" stroke="url(#accent)" stroke-width="4" opacity="0.5"/>

  <!-- Ícone de olho (símbolo do canal) -->
  <ellipse cx="${w / 2}" cy="140" rx="60" ry="35" fill="none" stroke="#a855f7" stroke-width="3" opacity="0.8"/>
  <circle cx="${w / 2}" cy="140" r="18" fill="#a855f7" opacity="0.9"/>
  <circle cx="${w / 2}" cy="140" r="8" fill="#fbbf24"/>

  <!-- Título principal -->
  ${textElements}

  <!-- Subtítulo / CTA -->
  <rect x="${w / 2 - 200}" y="${h - 100}" width="400" height="50" rx="25"
    fill="url(#accent)" opacity="0.9"/>
  <text
    x="${w / 2}" y="${h - 67}"
    font-family="Arial, sans-serif"
    font-size="24"
    fill="white"
    text-anchor="middle"
    dominant-baseline="middle"
    font-weight="bold"
  >CODEX MENTAL</text>

  <!-- Partículas decorativas -->
  <circle cx="120" cy="120" r="4" fill="#a855f7" opacity="0.6"/>
  <circle cx="80" cy="200" r="2" fill="#fbbf24" opacity="0.5"/>
  <circle cx="1160" cy="150" r="4" fill="#a855f7" opacity="0.6"/>
  <circle cx="1200" cy="80" r="2" fill="#fbbf24" opacity="0.5"/>
  <circle cx="200" cy="600" r="3" fill="#7c3aed" opacity="0.4"/>
  <circle cx="1100" cy="580" r="3" fill="#7c3aed" opacity="0.4"/>
</svg>`;
}

function buildTiktokSVG(title) {
  const w = 1080;
  const h = 1920;

  const words = title.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > 18) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());

  const lineHeight = 100;
  const startY = h / 2 - (lines.length * lineHeight) / 2;

  const textElements = lines
    .map(
      (line, i) => `
    <text
      x="${w / 2}" y="${startY + i * lineHeight}"
      font-family="Arial Black, Arial, sans-serif"
      font-size="88"
      font-weight="900"
      fill="white"
      text-anchor="middle"
      dominant-baseline="middle"
      filter="url(#shadow)"
    >${line}</text>
  `
    )
    .join("");

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000000" flood-opacity="0.95"/>
    </filter>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a1a"/>
      <stop offset="40%" style="stop-color:#1a0a2e"/>
      <stop offset="100%" style="stop-color:#0a0a0f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6b21a8"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
  </defs>

  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${w / 2}" cy="${h / 2}" rx="400" ry="600" fill="#4c1d95" opacity="0.35"/>

  <!-- Olho no topo -->
  <ellipse cx="${w / 2}" cy="300" rx="90" ry="55" fill="none" stroke="#a855f7" stroke-width="4" opacity="0.9"/>
  <circle cx="${w / 2}" cy="300" r="28" fill="#a855f7"/>
  <circle cx="${w / 2}" cy="300" r="12" fill="#fbbf24"/>

  <!-- Título -->
  ${textElements}

  <!-- Badge inferior -->
  <rect x="${w / 2 - 220}" y="${h - 200}" width="440" height="70" rx="35" fill="url(#accent)" opacity="0.95"/>
  <text x="${w / 2}" y="${h - 157}"
    font-family="Arial, sans-serif" font-size="32" fill="white"
    text-anchor="middle" dominant-baseline="middle" font-weight="bold"
  >@codexmentalbr</text>

  <line x1="0" y1="${h - 12}" x2="${w}" y2="${h - 12}" stroke="url(#accent)" stroke-width="12"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

function stripEmojis(str) {
  return str.replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{27FF}|\u{2300}-\u{23FF}|\u{FE00}-\u{FEFF}|\u{1F000}-\u{1F02F}|\u{1F0A0}-\u{1F0FF}|\u{1F100}-\u{1F1FF}|\u{1F200}-\u{1F2FF}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA6F}|\u{1FA70}-\u{1FAFF}]/gu, "").trim();
}

export async function generateThumbnail(topicData, scriptData, outputDir) {
  mkdirSync(join(outputDir, "thumbnails"), { recursive: true });

  console.log("🖼️  [Thumbnail] Gerando thumbnails com Sharp...");

  const title = stripEmojis(scriptData.title?.youtube || topicData.topic || "Codex Mental");
  const tiktokTitle = stripEmojis(scriptData.title?.tiktok || title);

  const results = {};

  // YouTube (1280x720)
  const youtubePath = join(outputDir, "thumbnails", "youtube.png");
  const youtubeSvg = buildYoutubeSVG(title, "Codex Mental");
  await sharp(Buffer.from(youtubeSvg)).png().toFile(youtubePath);
  results.youtube = youtubePath;
  console.log("   ✅ YouTube thumbnail gerada (1280x720)");

  // TikTok (1080x1920)
  const tiktokPath = join(outputDir, "thumbnails", "tiktok.png");
  const tiktokSvg = buildTiktokSVG(tiktokTitle);
  await sharp(Buffer.from(tiktokSvg)).png().toFile(tiktokPath);
  results.tiktok = tiktokPath;
  console.log("   ✅ TikTok thumbnail gerada (1080x1920)");

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

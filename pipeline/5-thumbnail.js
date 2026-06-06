/**
 * Módulo 5: Thumbnail — Geração de thumbnail com DALL-E 3
 *
 * Gera thumbnails otimizadas para YouTube (1280x720)
 * e TikTok (1080x1920) com estética dark/misteriosa.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Geração de thumbnail com DALL-E 3
// ---------------------------------------------------------------------------

async function generateImage(prompt, size, outputPath) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size,
    quality: "hd",
    style: "vivid",
  });

  const imageUrl = response.data[0].url;

  // Download da imagem
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Erro ao baixar imagem: ${res.status}`);
  const buffer = await res.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));

  return outputPath;
}

// ---------------------------------------------------------------------------
// Monta o prompt visual baseado no tema
// ---------------------------------------------------------------------------

function buildThumbnailPrompt(topicData, scriptData) {
  const baseStyle =
    "dark dramatic atmosphere, deep purple and black tones, mysterious silhouettes, " +
    "cinematic lighting, psychological thriller aesthetic, photorealistic, ultra detailed, " +
    "no text, no words, no letters";

  const thumbnailPrompt = topicData.thumbnailPrompt || topicData.topic;

  return `${thumbnailPrompt}. ${baseStyle}`;
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function generateThumbnail(topicData, scriptData, outputDir) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada no .env");
  }

  mkdirSync(join(outputDir, "thumbnails"), { recursive: true });

  console.log("🖼️  [Thumbnail] Gerando thumbnails com DALL-E 3...");

  const prompt = buildThumbnailPrompt(topicData, scriptData);
  console.log(`   → Prompt: "${prompt.slice(0, 80)}..."`);

  const results = {};

  // YouTube thumbnail (1280x720)
  console.log("   → Gerando YouTube thumbnail (1280x720)...");
  const youtubePath = join(outputDir, "thumbnails", "youtube.png");
  try {
    await generateImage(prompt, "1792x1024", youtubePath);
    results.youtube = youtubePath;
    console.log("   ✅ YouTube thumbnail gerada");
  } catch (e) {
    console.warn(`   ⚠️  Falha YouTube thumbnail: ${e.message}`);
  }

  // TikTok thumbnail (1080x1920) — portrait
  console.log("   → Gerando TikTok thumbnail (1024x1792)...");
  const tiktokPath = join(outputDir, "thumbnails", "tiktok.png");
  try {
    const portraitPrompt = prompt + ", vertical composition, portrait orientation";
    await generateImage(portraitPrompt, "1024x1792", tiktokPath);
    results.tiktok = tiktokPath;
    console.log("   ✅ TikTok thumbnail gerada");
  } catch (e) {
    console.warn(`   ⚠️  Falha TikTok thumbnail: ${e.message}`);
  }

  console.log(`✅ [Thumbnail] Thumbnails salvas em ${outputDir}/thumbnails/`);

  return {
    youtube: results.youtube || null,
    tiktok: results.tiktok || null,
    prompt,
  };
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/5-thumbnail.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const testTopic = {
    topic: "3 sinais que alguém está mentindo para você",
    thumbnailPrompt:
      "close-up of a human eye with dark dramatic lighting, mysterious silhouette in background, psychological thriller",
  };

  const testScript = {
    title: { youtube: "3 Sinais Que Alguém Está Mentindo Para Você" },
  };

  const outputDir = join(__dirname, "../output/test-thumbnail");

  generateThumbnail(testTopic, testScript, outputDir)
    .then((result) => {
      console.log("\n📦 Resultado:");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((e) => {
      console.error("❌ Erro no thumbnail:", e.message);
      process.exit(1);
    });
}

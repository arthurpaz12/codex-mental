/**
 * Módulo 4: Media — Busca de vídeos e imagens no Pexels
 *
 * Usa o searchQuery gerado pelo módulo 1 para buscar
 * footage relevante para o vídeo.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PEXELS_API_URL = "https://api.pexels.com/v1";
const PEXELS_VIDEO_URL = "https://api.pexels.com/videos";

// ---------------------------------------------------------------------------
// Busca de vídeos
// ---------------------------------------------------------------------------

async function searchVideos(query, perPage = 10) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY não configurada no .env");

  const params = new URLSearchParams({
    query,
    per_page: perPage,
    orientation: "landscape",
    size: "large",
  });

  const res = await fetch(`${PEXELS_VIDEO_URL}/search?${params}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) throw new Error(`Pexels API erro ${res.status}`);
  const data = await res.json();
  return data.videos || [];
}

// ---------------------------------------------------------------------------
// Busca de imagens (fallback se não tiver vídeos suficientes)
// ---------------------------------------------------------------------------

async function searchImages(query, perPage = 10) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY não configurada no .env");

  const params = new URLSearchParams({
    query,
    per_page: perPage,
    orientation: "landscape",
    size: "large",
  });

  const res = await fetch(`${PEXELS_API_URL}/search?${params}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) throw new Error(`Pexels API erro ${res.status}`);
  const data = await res.json();
  return data.photos || [];
}

// ---------------------------------------------------------------------------
// Download de arquivo
// ---------------------------------------------------------------------------

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro ao baixar: ${url}`);
  const buffer = await res.arrayBuffer();
  writeFileSync(destPath, Buffer.from(buffer));
  return destPath;
}

// ---------------------------------------------------------------------------
// Seleciona os melhores vídeos (curtos, HD, relevantes)
// ---------------------------------------------------------------------------

function selectBestVideos(videos, maxCount = 5) {
  return videos
    .filter((v) => {
      const files = v.video_files || [];
      const hasHD = files.some(
        (f) => f.width >= 1280 && f.file_type === "video/mp4"
      );
      return hasHD && v.duration <= 30;
    })
    .slice(0, maxCount)
    .map((v) => {
      const hdFile = v.video_files
        .filter((f) => f.width >= 1280 && f.file_type === "video/mp4")
        .sort((a, b) => b.width - a.width)[0];
      return {
        id: v.id,
        duration: v.duration,
        width: hdFile.width,
        height: hdFile.height,
        url: hdFile.link,
        thumbnail: v.image,
      };
    });
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function fetchMedia(topicData, outputDir) {
  mkdirSync(join(outputDir, "media"), { recursive: true });

  const { searchQuery, topic, angle } = topicData;

  console.log("🎬 [Media] Buscando footage no Pexels...");
  console.log(`   → Query: "${searchQuery}"`);

  // Busca principal com a query do módulo 1
  let videos = await searchVideos(searchQuery, 15);

  // Fallback: busca por termos psicologia se não achar vídeos bons
  if (videos.length < 3) {
    console.log("   → Poucos resultados, tentando query alternativa...");
    videos = await searchVideos("psychology human behavior mind", 15);
  }

  const selected = selectBestVideos(videos, 5);
  console.log(`   → ${selected.length} vídeos selecionados`);

  // Busca imagens também para usar como B-roll ou thumbnails
  const images = await searchImages(searchQuery, 5);
  console.log(`   → ${images.length} imagens encontradas`);

  // Download dos vídeos selecionados
  const downloadedVideos = [];
  for (let i = 0; i < selected.length; i++) {
    const video = selected[i];
    const videoPath = join(outputDir, "media", `clip-${i + 1}.mp4`);
    console.log(`   → Baixando clip ${i + 1}/${selected.length}...`);
    try {
      await downloadFile(video.url, videoPath);
      downloadedVideos.push({ ...video, localPath: videoPath });
    } catch (e) {
      console.warn(`   ⚠️  Falha ao baixar clip ${i + 1}: ${e.message}`);
    }
  }

  // Download da primeira imagem como fallback
  const imagePath = join(outputDir, "media", "background.jpg");
  if (images.length > 0) {
    const imgUrl = images[0].src?.large2x || images[0].src?.large;
    if (imgUrl) await downloadFile(imgUrl, imagePath);
  }

  console.log(`✅ [Media] ${downloadedVideos.length} clips baixados`);

  return {
    videos: downloadedVideos,
    images: images.slice(0, 3).map((img) => ({
      id: img.id,
      url: img.src?.large2x || img.src?.large,
      photographer: img.photographer,
    })),
    backgroundImage: imagePath,
    query: searchQuery,
  };
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/4-media.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const testTopic = {
    searchQuery: "human psychology mind brain behavior",
    topic: "3 sinais que alguém está mentindo",
    angle: "microexpressões faciais involuntárias",
  };

  const outputDir = join(__dirname, "../output/test-media");

  fetchMedia(testTopic, outputDir)
    .then((result) => {
      console.log("\n📦 Resultado:");
      console.log(
        JSON.stringify(
          { ...result, videos: result.videos.map((v) => v.localPath) },
          null,
          2
        )
      );
    })
    .catch((e) => {
      console.error("❌ Erro no media:", e.message);
      process.exit(1);
    });
}

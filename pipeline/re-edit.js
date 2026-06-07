/**
 * Re-edit — Re-renderiza thumbnail e/ou vídeo de uma execução já existente,
 * SEM gastar créditos de API (Claude, ElevenLabs, Pexels, etc).
 *
 * Reaproveita o roteiro, a narração (.mp3) e o footage (clips/imagens) já
 * baixados em uma pasta de output anterior, e roda de novo só os módulos
 * locais e gratuitos:
 *   - Módulo 5: Thumbnail (Sharp/SVG)
 *   - Módulo 6: Video     (FFmpeg)
 *
 * Use isso pra ajustar cortes, textos, cores, legendas, overlays, layout
 * da thumbnail etc. e testar o resultado quantas vezes quiser de graça.
 *
 * Uso:
 *   node pipeline/re-edit.js                       → usa a execução mais recente com vídeo
 *   node pipeline/re-edit.js 2026-06-06T20-00-19   → usa uma execução específica (nome da pasta em output/)
 *   node pipeline/re-edit.js --only video          → roda só o módulo 6 (vídeo)
 *   node pipeline/re-edit.js --only thumbnail      → roda só o módulo 5 (thumbnail)
 *
 * O resultado é salvo em uma NOVA pasta output/<runId>-reedit-<timestamp>/,
 * sem sobrescrever a execução original.
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

import { generateThumbnail } from "./5-thumbnail.js";
import { assembleVideo } from "./6-video.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = join(__dirname, "../output");

const args = process.argv.slice(2);
const onlyArg = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? args[i + 1] : null;
})();
const runArg = args.find((a) => !a.startsWith("--") && a !== onlyArg);

function loadJSON(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return fallback; }
}

/**
 * Encontra a execução mais recente que tenha vídeo/roteiro/narração completos.
 */
function findLatestCompleteRun() {
  const dirs = readdirSync(OUTPUT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name)) // ignora pastas de teste manuais
    .sort()
    .reverse();

  for (const name of dirs) {
    const dir = join(OUTPUT_ROOT, name);
    const hasScript = existsSync(join(dir, "2-script.json"));
    const hasVoice = existsSync(join(dir, "3-voice.json"));
    const hasMedia = existsSync(join(dir, "media"));
    if (hasScript && hasVoice && hasMedia) return name;
  }
  return null;
}

/**
 * Reconstrói o objeto `media` (mesmo formato retornado por fetchMedia)
 * a partir dos arquivos já baixados na pasta media/ da execução original.
 */
function rebuildMediaData(sourceDir, destDir) {
  const srcMediaDir = join(sourceDir, "media");
  const destMediaDir = join(destDir, "media");
  mkdirSync(destMediaDir, { recursive: true });

  const files = readdirSync(srcMediaDir);
  const videos = [];
  let backgroundImage = null;

  for (const file of files.sort()) {
    const srcPath = join(srcMediaDir, file);
    const destPath = join(destMediaDir, file);
    copyFileSync(srcPath, destPath);

    if (/^clip-\d+\.mp4$/.test(file)) {
      videos.push({ localPath: destPath });
    } else if (file === "background.jpg") {
      backgroundImage = destPath;
    }
  }

  return { videos, images: [], backgroundImage };
}

async function run() {
  const runId = runArg || findLatestCompleteRun();
  if (!runId) {
    console.error("❌ Nenhuma execução completa encontrada em output/ (precisa de roteiro + narração + media).");
    process.exit(1);
  }

  const sourceDir = join(OUTPUT_ROOT, runId);
  if (!existsSync(sourceDir)) {
    console.error(`❌ Pasta não encontrada: ${sourceDir}`);
    process.exit(1);
  }

  const topic = loadJSON(join(sourceDir, "1-topic.json"));
  const script = loadJSON(join(sourceDir, "2-script.json"));
  const voice = loadJSON(join(sourceDir, "3-voice.json"));

  if (!script || !voice) {
    console.error("❌ Faltam 2-script.json e/ou 3-voice.json nessa execução — não dá pra reaproveitar.");
    process.exit(1);
  }

  const reeditId = `${runId}-reedit-${new Date().toISOString().replace(/[:.]/g, "-").slice(11, 19)}`;
  const destDir = join(OUTPUT_ROOT, reeditId);
  mkdirSync(destDir, { recursive: true });

  console.log(`\n♻️  RE-EDIÇÃO LOCAL — sem custo de API`);
  console.log(`   → Origem:  output/${runId}`);
  console.log(`   → Destino: output/${reeditId}`);
  if (topic) console.log(`   → Tema: "${topic.topic}"`);

  // Copia a narração
  const audioSrc = voice.audioPath;
  const audioDest = join(destDir, basename(audioSrc));
  copyFileSync(audioSrc, audioDest);
  const voiceForReedit = { ...voice, audioPath: audioDest };

  // Reconstrói o objeto de mídia (clips + background) a partir dos arquivos já baixados
  const media = existsSync(join(sourceDir, "media"))
    ? rebuildMediaData(sourceDir, destDir)
    : { videos: [], images: [], backgroundImage: null };

  let thumbnail = loadJSON(join(sourceDir, "5-thumbnail.json"), {});
  const runThumbnail = !onlyArg || onlyArg === "thumbnail";
  const runVideo = !onlyArg || onlyArg === "video";

  if (runThumbnail) {
    console.log("\n🖼️  Gerando thumbnail (Sharp/SVG)...");
    thumbnail = await generateThumbnail(topic || {}, script, destDir, media);
    writeFileSync(join(destDir, "5-thumbnail.json"), JSON.stringify(thumbnail, null, 2));
  } else if (thumbnail && Object.keys(thumbnail).length) {
    // Reaproveita a thumbnail original copiando os arquivos
    const srcThumbDir = join(sourceDir, "thumbnails");
    if (existsSync(srcThumbDir)) {
      const destThumbDir = join(destDir, "thumbnails");
      mkdirSync(destThumbDir, { recursive: true });
      for (const f of readdirSync(srcThumbDir)) copyFileSync(join(srcThumbDir, f), join(destThumbDir, f));
      thumbnail = {
        youtube: join(destThumbDir, "youtube.png"),
        tiktok: join(destThumbDir, "tiktok.png"),
      };
    }
  }

  if (runVideo) {
    console.log("\n🎬 Montando vídeo (FFmpeg)...");
    const video = await assembleVideo(script, voiceForReedit, media, thumbnail || {}, destDir);
    writeFileSync(join(destDir, "6-video.json"), JSON.stringify(video, null, 2));

    console.log("\n✅ Vídeo re-renderizado com sucesso!");
    console.log(`   → YouTube: ${video.youtube || "—"}`);
    console.log(`   → TikTok:  ${video.tiktok || "—"}`);
  }

  console.log(`\n📁 Resultado completo em: output/${reeditId}`);
  console.log("   Revise o vídeo/thumbnail localmente. Se estiver bom, publique manualmente");
  console.log("   ou ajuste o código (5-thumbnail.js / 6-video.js) e rode de novo — é de graça.");
}

run().catch((err) => {
  console.error(`\n❌ Falha na re-edição: ${err.message}`);
  process.exit(1);
});

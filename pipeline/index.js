/**
 * Pipeline Codex Mental — Orquestrador Principal
 *
 * Executa todos os módulos em sequência:
 * 1. Research  — escolhe o tema do dia
 * 2. Script    — gera o roteiro com Claude
 * 3. Voice     — narra com ElevenLabs
 * 4. Media     — busca footage no Pexels
 * 5. Thumbnail — gera thumbnail com DALL-E 3
 * 6. Video     — monta o vídeo com Creatomate
 * 7. Publish   — publica no YouTube e TikTok
 *
 * Uso:
 *   node pipeline/index.js              → roda tudo
 *   node pipeline/index.js --step 1,2  → roda só os módulos 1 e 2
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { runResearch } from "./1-research.js";
import { generateScript } from "./2-script.js";
import { generateVoice } from "./3-voice.js";
import { fetchMedia } from "./4-media.js";
import { generateThumbnail } from "./5-thumbnail.js";
import { assembleVideo } from "./6-video.js";
import { publishVideos } from "./7-publish.js";
import { suggestSound } from "./8-sound.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const stepArg =
  args.find((a) => a.startsWith("--step"))?.split("=")[1] ||
  args[args.indexOf("--step") + 1];
const steps = stepArg ? stepArg.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const runStep = (n) => steps.includes(n);

function save(dir, filename, data) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2));
}

function printSeparator(step, title) {
  console.log("\n" + "═".repeat(52));
  console.log(`  MÓDULO ${step}: ${title}`);
  console.log("═".repeat(52));
}

async function run() {
  const startTime = Date.now();
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = join(__dirname, "../output", runId);

  mkdirSync(outputDir, { recursive: true });
  console.log(`\n🚀 CODEX MENTAL PIPELINE — Run ${runId}`);
  console.log(`   Módulos: [${steps.join(", ")}]`);
  console.log(`📁 Output: ${outputDir}`);

  const state = { runId, outputDir, startedAt: new Date().toISOString() };

  try {
    // ── Módulo 1: Research ──────────────────────────────────────
    if (runStep(1)) {
      printSeparator(1, "RESEARCH — Escolhendo tema do dia");
      state.topic = await runResearch();
      save(outputDir, "1-topic.json", state.topic);
    }

    // ── Módulo 2: Script ────────────────────────────────────────
    if (runStep(2)) {
      printSeparator(2, "SCRIPT — Gerando roteiro");
      if (!state.topic) throw new Error("Módulo 1 não executado. Use --step 1,2");
      state.script = await generateScript(state.topic);
      save(outputDir, "2-script.json", state.script);
    }

    // ── Módulo 3: Voice ─────────────────────────────────────────
    if (runStep(3)) {
      printSeparator(3, "VOICE — Narrando com ElevenLabs");
      if (!state.script) throw new Error("Módulo 2 não executado. Use --step 1,2,3");
      state.voice = await generateVoice(state.script, outputDir);
      save(outputDir, "3-voice.json", state.voice);
    }

    // ── Módulo 4: Media ─────────────────────────────────────────
    if (runStep(4)) {
      printSeparator(4, "MEDIA — Buscando footage no Pexels");
      if (!state.topic) throw new Error("Módulo 1 não executado.");
      state.media = await fetchMedia(state.topic, outputDir);
      save(outputDir, "4-media.json", {
        query: state.media.query,
        videoCount: state.media.videos.length,
        imageCount: state.media.images.length,
      });
    }

    // ── Módulo 5: Thumbnail ─────────────────────────────────────
    if (runStep(5)) {
      printSeparator(5, "THUMBNAIL — Gerando com DALL-E 3");
      if (!state.topic || !state.script) throw new Error("Módulos 1 e 2 não executados.");
      state.thumbnail = await generateThumbnail(state.topic, state.script, outputDir);
      save(outputDir, "5-thumbnail.json", state.thumbnail);
    }

    // ── Módulo 6: Video ─────────────────────────────────────────
    if (runStep(6)) {
      printSeparator(6, "VIDEO — Montando com Creatomate");
      if (!state.script || !state.voice || !state.media) {
        throw new Error("Módulos 2, 3 e 4 são necessários para montar o vídeo.");
      }
      state.video = await assembleVideo(
        state.script,
        state.voice,
        state.media,
        state.thumbnail || {},
        outputDir
      );
      save(outputDir, "6-video.json", state.video);
    }

    // ── Módulo 7: Publish ───────────────────────────────────────
    if (runStep(7)) {
      printSeparator(7, "PUBLISH — Publicando no YouTube e TikTok");
      if (!state.video) throw new Error("Módulo 6 não executado.");
      state.publish = await publishVideos(state.video, state.script, state.topic);
      save(outputDir, "7-publish.json", state.publish);
    }

    // ── Módulo 8: Sound (sugestão de áudio para o TikTok) ───────
    if (runStep(8)) {
      printSeparator(8, "SOUND — Sugestão de som para o TikTok");
      state.sound = await suggestSound(outputDir);
      save(outputDir, "8-sound.json", state.sound);
    }

    // ── Sumário final ───────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    state.completedAt = new Date().toISOString();
    state.elapsedSeconds = parseFloat(elapsed);
    save(outputDir, "pipeline-state.json", state);

    console.log("\n" + "═".repeat(52));
    console.log("  ✅ PIPELINE CONCLUÍDO!");
    console.log("═".repeat(52));
    console.log(`\n⏱️  Duração: ${elapsed}s`);
    console.log(`📁 Arquivos: ${outputDir}`);

    if (state.topic) {
      console.log(`\n📌 Tema: "${state.topic.topic}"`);
      console.log(`   Viral score: ${state.topic.viralScore}/100`);
    }

    if (state.publish?.length > 0) {
      console.log("\n🔗 Publicado em:");
      state.publish.forEach((p) => console.log(`   → ${p.platform}: ${p.url}`));
    }

    if (state.sound) {
      console.log("\n🎵 Sugestão de som para o TikTok (adicionar manualmente ao postar):");
      console.log(`   → Categoria: ${state.sound.category}`);
      console.log(`   → Som: ${state.sound.sound}`);
      console.log(`   → Busque por: ${state.sound.searchHint}`);
      console.log(`   → Dica: ${state.sound.tip}`);
    }

  } catch (err) {
    console.error(`\n❌ Pipeline falhou no módulo: ${err.message}`);
    state.error = err.message;
    save(outputDir, "pipeline-state.json", state);
    process.exit(1);
  }
}

run();

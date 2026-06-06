/**
 * Pipeline Orchestrator — Executa todos os módulos em sequência
 *
 * Uso:
 *   node pipeline/index.js              → roda pipeline completo
 *   node pipeline/index.js --step 1     → roda só o research
 *   node pipeline/index.js --step 1,2   → roda research + script
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const stepArg = args.find((a) => a.startsWith("--step"))?.split("=")[1] ||
  args[args.indexOf("--step") + 1];
const steps = stepArg ? stepArg.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7];

const runStep = (n) => steps.includes(n) || steps.length === 0;

async function run() {
  const startTime = Date.now();
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = join(__dirname, "../output", runId);

  mkdirSync(outputDir, { recursive: true });
  console.log(`\n🚀 AUTO-CONTENT PIPELINE — Run ${runId}`);
  console.log(`📁 Output: ${outputDir}\n`);

  const state = { runId, outputDir, startedAt: new Date().toISOString() };

  try {
    // Step 1 — Research
    if (runStep(1)) {
      const { runResearch } = await import("./1-research.js");
      state.topic = await runResearch();
      save(outputDir, "1-topic.json", state.topic);
    }

    // Step 2 — Script
    if (runStep(2)) {
      const { generateScript } = await import("./2-script.js");
      state.script = await generateScript(state.topic);
      save(outputDir, "2-script.json", state.script);
    }

    // Step 3 — Voice (ElevenLabs)
    if (runStep(3)) {
      console.log("🎙️  [Voice] Módulo 3 — em breve...");
      // const { generateVoice } = await import('./3-voice.js')
      // state.audio = await generateVoice(state.script)
    }

    // Step 4 — Media (Pexels)
    if (runStep(4)) {
      console.log("🖼️  [Media] Módulo 4 — em breve...");
    }

    // Step 5 — Thumbnail (DALL-E 3)
    if (runStep(5)) {
      console.log("🎨 [Thumbnail] Módulo 5 — em breve...");
    }

    // Step 6 — Video (Creatomate)
    if (runStep(6)) {
      console.log("🎬 [Video] Módulo 6 — em breve...");
    }

    // Step 7 — Publish (YouTube + TikTok)
    if (runStep(7)) {
      console.log("📤 [Publish] Módulo 7 — em breve...");
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    state.completedAt = new Date().toISOString();
    state.elapsedSeconds = parseFloat(elapsed);
    save(outputDir, "pipeline-state.json", state);

    console.log(`\n✅ Pipeline concluído em ${elapsed}s`);
    console.log(`📁 Resultados em: ${outputDir}`);
  } catch (err) {
    console.error(`\n❌ Pipeline falhou:`, err.message);
    state.error = err.message;
    save(outputDir, "pipeline-state.json", state);
    process.exit(1);
  }
}

function save(dir, filename, data) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2));
}

run();

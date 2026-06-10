/**
 * Brazil Noir Pipeline — Orquestrador Principal
 *
 * Canal de True Crime brasileiro em inglês para audiência global.
 * Roda os mesmos módulos de produção do Codex Mental (voz, mídia,
 * thumbnail, vídeo, publicação) com research e roteiro próprios.
 *
 * Uso:
 *   node pipeline/brazil-noir/index.js
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFile, execSync } from "child_process";

// Módulos próprios do Brazil Noir
import { runResearch } from "./1-research.js";
import { generateScript } from "./2-script.js";

// Módulos compartilhados com Codex Mental (reutilizados 100%)
import { generateVoice } from "../3-voice.js";
import { fetchMedia } from "../4-media.js";
import { generateThumbnail } from "../5-thumbnail.js";
import { assembleVideo } from "../6-video.js";
import { publishVideos } from "../7-publish.js";
import { suggestSound } from "../8-sound.js";
import { updateDashboard } from "../9-dashboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Settings do canal Brazil Noir (afiliados, etc.)
const bnSettings = JSON.parse(
  readFileSync(join(__dirname, "../../config/settings-brazil-noir.json"), "utf-8")
);
const REPO_DIR = join(__dirname, "../..");

function save(dir, filename, data) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2));
}

function notify(title, message, subtitle = "") {
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}${
    subtitle ? ` subtitle ${JSON.stringify(subtitle)}` : ""
  } sound name "Glass"`;
  execFile("osascript", ["-e", script], (err) => {
    if (err) console.warn(`   ⚠️  Notification failed: ${err.message}`);
  });
}

function printSeparator(step, title) {
  console.log("\n" + "═".repeat(52));
  console.log(`  MODULE ${step}: ${title}`);
  console.log("═".repeat(52));
}

function commitAndPushDashboardData(runId) {
  const opts = { cwd: REPO_DIR, stdio: ["ignore", "pipe", "pipe"] };
  try {
    const status = execSync(
      "git status --porcelain dashboard/data.json dashboard/insights.json",
      opts
    ).toString().trim();
    if (!status) { console.log("   ℹ️  No dashboard changes to commit."); return; }
    execSync("git add dashboard/data.json dashboard/insights.json", opts);
    const message = `Atualiza dados do dashboard Brazil Noir (run ${runId})\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`;
    execSync(`git commit -m ${JSON.stringify(message)}`, opts);
    execSync("git push", opts);
    console.log("   ✅ Dashboard data committed and pushed.");
  } catch (e) {
    console.warn(`   ⚠️  Auto-commit failed: ${e.stderr?.toString().trim() || e.message}`);
  }
}

async function run() {
  const startTime = Date.now();
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = join(REPO_DIR, "output/brazil-noir", runId);

  mkdirSync(outputDir, { recursive: true });
  console.log(`\n🕵️ BRAZIL NOIR PIPELINE — Run ${runId}`);
  console.log(`📁 Output: ${outputDir}`);

  const state = { runId, outputDir, startedAt: new Date().toISOString(), channel: "brazil-noir" };

  notify("🕵️ Brazil Noir", "Researching a new dark story from Brazil...", "Pipeline started");

  try {
    // ── Module 1: Research ──────────────────────────────────────
    printSeparator(1, "RESEARCH — Selecting Brazilian true crime case");
    state.topic = await runResearch();
    save(outputDir, "1-topic.json", state.topic);

    // ── Module 2: Script ────────────────────────────────────────
    printSeparator(2, "SCRIPT — Writing true crime script in English");
    state.script = await generateScript(state.topic);
    save(outputDir, "2-script.json", state.script);

    // ── Module 3: Voice ─────────────────────────────────────────
    printSeparator(3, "VOICE — Narrating with ElevenLabs");
    // Usa voz em inglês configurada em BRAZIL_NOIR_VOICE_ID (ou fallback para a padrão)
    const originalVoiceId = process.env.ELEVENLABS_VOICE_ID;
    if (process.env.BRAZIL_NOIR_VOICE_ID) {
      process.env.ELEVENLABS_VOICE_ID = process.env.BRAZIL_NOIR_VOICE_ID;
    }
    state.voice = await generateVoice(state.script, outputDir);
    save(outputDir, "3-voice.json", state.voice);
    // Restaura voz original
    if (process.env.BRAZIL_NOIR_VOICE_ID) {
      process.env.ELEVENLABS_VOICE_ID = originalVoiceId;
    }

    // ── Module 4: Media ─────────────────────────────────────────
    printSeparator(4, "MEDIA — Fetching dark crime footage from Pexels");
    state.media = await fetchMedia(state.topic, outputDir);
    save(outputDir, "4-media.json", {
      query: state.media.query,
      videoCount: state.media.videos.length,
      imageCount: state.media.images.length,
    });

    // ── Module 5: Thumbnail ─────────────────────────────────────
    printSeparator(5, "THUMBNAIL — Generating dark crime thumbnail");
    state.thumbnail = await generateThumbnail(state.topic, state.script, outputDir, state.media);
    save(outputDir, "5-thumbnail.json", state.thumbnail);

    // ── Module 6: Video ─────────────────────────────────────────
    printSeparator(6, "VIDEO — Assembling with FFmpeg");
    state.video = await assembleVideo(
      state.script,
      state.voice,
      state.media,
      state.thumbnail || {},
      outputDir,
      { channel: "brazil-noir" }
    );
    save(outputDir, "6-video.json", state.video);

    // ── Module 7: Publish ───────────────────────────────────────
    printSeparator(7, "PUBLISH — Publishing to YouTube & TikTok (Brazil Noir)");
    // Troca credenciais para o canal Brazil Noir
    const ytOriginal = { id: process.env.YOUTUBE_CLIENT_ID, secret: process.env.YOUTUBE_CLIENT_SECRET, refresh: process.env.YOUTUBE_REFRESH_TOKEN };
    const tkOriginal = { token: process.env.TIKTOK_ACCESS_TOKEN, refresh: process.env.TIKTOK_REFRESH_TOKEN, client: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET };

    if (process.env.BN_YOUTUBE_CLIENT_ID) {
      process.env.YOUTUBE_CLIENT_ID     = process.env.BN_YOUTUBE_CLIENT_ID;
      process.env.YOUTUBE_CLIENT_SECRET = process.env.BN_YOUTUBE_CLIENT_SECRET;
      process.env.YOUTUBE_REFRESH_TOKEN = process.env.BN_YOUTUBE_REFRESH_TOKEN;
    }
    if (process.env.BN_TIKTOK_ACCESS_TOKEN) {
      process.env.TIKTOK_ACCESS_TOKEN  = process.env.BN_TIKTOK_ACCESS_TOKEN;
      process.env.TIKTOK_REFRESH_TOKEN = process.env.BN_TIKTOK_REFRESH_TOKEN;
      // Usa o client key/secret do Codex Mental (app que autenticou @brazilnoir)
    }

    state.publish = await publishVideos(state.video, state.script, state.topic, {
      affiliate: bnSettings.affiliate,
    });
    save(outputDir, "7-publish.json", state.publish);

    // Restaura credenciais originais
    process.env.YOUTUBE_CLIENT_ID     = ytOriginal.id;
    process.env.YOUTUBE_CLIENT_SECRET = ytOriginal.secret;
    process.env.YOUTUBE_REFRESH_TOKEN = ytOriginal.refresh;
    process.env.TIKTOK_ACCESS_TOKEN   = tkOriginal.token;
    process.env.TIKTOK_REFRESH_TOKEN  = tkOriginal.refresh;
    process.env.TIKTOK_CLIENT_KEY     = tkOriginal.client;
    process.env.TIKTOK_CLIENT_SECRET  = tkOriginal.secret;

    if (state.publish?.length > 0) {
      const platforms = state.publish.map((p) => p.platform).join(", ");
      notify("✅ Brazil Noir — Published!", state.topic?.caseNameEN || "New dark story", `Platforms: ${platforms}`);
    } else {
      notify("⚠️ Brazil Noir", "Video ready but no platform published", "Check credentials");
    }

    // ── Module 8: Sound ─────────────────────────────────────────
    printSeparator(8, "SOUND — TikTok sound suggestion");
    state.sound = await suggestSound(outputDir);
    save(outputDir, "8-sound.json", state.sound);

    // ── Summary ─────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    state.completedAt = new Date().toISOString();
    state.elapsedSeconds = parseFloat(elapsed);
    save(outputDir, "pipeline-state.json", state);

    // Registra a execução no dashboard (histórico compartilhado com Codex Mental)
    await updateDashboard(state);

    console.log("\n" + "═".repeat(52));
    console.log("  ✅ BRAZIL NOIR PIPELINE COMPLETE!");
    console.log("═".repeat(52));
    console.log(`\n⏱️  Duration: ${elapsed}s`);
    console.log(`📁 Files: ${outputDir}`);
    console.log(`\n📌 Case: "${state.topic.topic}"`);

    if (state.publish?.length > 0) {
      console.log("\n🔗 Published at:");
      state.publish.forEach((p) => console.log(`   → ${p.platform}: ${p.url}`));
    }

    commitAndPushDashboardData(runId);

  } catch (err) {
    console.error(`\n❌ Brazil Noir pipeline failed: ${err.message}`);
    state.error = err.message;
    state.completedAt = new Date().toISOString();
    save(outputDir, "pipeline-state.json", state);
    process.exit(1);
  }
}

run();

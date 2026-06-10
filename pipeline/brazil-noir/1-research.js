/**
 * Brazil Noir — Módulo 1: Research
 *
 * Seleciona um caso de true crime brasileiro ainda não coberto,
 * usando Claude para escolher o mais impactante para a audiência
 * anglófona e gerar o briefing completo do episódio.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(
  readFileSync(join(__dirname, "../../config/settings-brazil-noir.json"), "utf-8")
);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Histórico de casos já cobertos (evita repetição)
const HISTORY_PATH = join(__dirname, "../../data/brazil-noir-cases.json");

function loadCoveredCases() {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveCoveredCase(caseName) {
  const covered = loadCoveredCases();
  covered.push({ case: caseName, coveredAt: new Date().toISOString() });
  writeFileSync(HISTORY_PATH, JSON.stringify(covered, null, 2));
}

export async function runResearch() {
  console.log("🔍 [Brazil Noir Research] Selecionando caso de true crime brasileiro...");

  const covered = loadCoveredCases();
  const coveredNames = covered.map((c) => c.case).join(", ") || "none yet";

  const response = await client.messages.create({
    model: settings.script.model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: `You are a true crime content strategist for "Brazil Noir", a YouTube channel that covers
real Brazilian criminal cases for English-speaking audiences. You select the most compelling,
dramatic, and internationally appealing Brazilian true crime cases — stories that American,
British, and Australian audiences have never heard, but would be completely captivated by.

You prioritize cases with:
- Shocking twists or unexpected suspects
- Elements of betrayal, obsession, or social commentary
- Strong visual storytelling potential
- Clear narrative arc (crime → investigation → resolution or mystery)
- Universal emotional hooks (family betrayal, love gone wrong, corruption, serial killers)

Always return valid JSON.`,
    messages: [
      {
        role: "user",
        content: `Select the best Brazilian true crime case to cover today for the Brazil Noir YouTube channel.

Cases already covered (do NOT repeat): ${coveredNames}

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

Choose a real Brazilian criminal case that:
1. Has never been widely covered in English-language media
2. Has a gripping narrative that works in 60 seconds
3. Would shock and captivate an English-speaking true crime audience
4. Has publicly available information (news articles, court records, Wikipedia)

Return ONLY valid JSON in this exact format:

{
  "topic": "The [Name] Case: [One-line dramatic description]",
  "caseName": "Official case name in Portuguese",
  "caseNameEN": "Case name in English",
  "year": 1990,
  "location": "City, State, Brazil",
  "category": "serial killer | murder | corruption | cold case | unsolved | heist | cult",
  "angle": "The unique shocking angle that makes this case perfect for international audiences",
  "hook": "Opening line — maximum 15 words, must be shocking",
  "summary": "2-3 sentence factual summary of the case",
  "keyFacts": ["shocking fact 1", "shocking fact 2", "shocking fact 3"],
  "twist": "The most shocking reveal or twist in the case",
  "searchQuery": "Pexels search query for relevant dark/crime footage (no faces, no real crime scenes)",
  "thumbnailConcept": "Visual concept for thumbnail — dark, cinematic, symbolic",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "viralScore": 85,
  "reasoning": "Why this case will captivate English-speaking true crime fans"
}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude did not return valid JSON");

  const topic = JSON.parse(match[0]);

  // Salva no histórico
  saveCoveredCase(topic.caseName || topic.topic);

  console.log(`✅ [Brazil Noir Research] Case selected: "${topic.topic}"`);
  console.log(`   Viral score: ${topic.viralScore}/100 | Category: ${topic.category}`);
  console.log(`   Angle: ${topic.angle}`);

  return topic;
}

// Execução direta
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runResearch()
    .then((t) => {
      console.log("\n📦 Full result:");
      console.log(JSON.stringify(t, null, 2));
    })
    .catch((e) => {
      console.error("❌ Research error:", e.message);
      process.exit(1);
    });
}

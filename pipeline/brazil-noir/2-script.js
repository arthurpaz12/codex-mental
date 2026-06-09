/**
 * Brazil Noir — Módulo 2: Script
 *
 * Gera roteiro de true crime em inglês no estilo
 * cinematográfico/podcast — drama, tensão, reviravolta.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(
  readFileSync(join(__dirname, "../../config/settings-brazil-noir.json"), "utf-8")
);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateScript(topic) {
  console.log(`📝 [Brazil Noir Script] Writing script for: "${topic.topic}"...`);

  const { wordCount, tone, cta } = settings.script;
  const { defaultTags } = settings.youtube;
  const { defaultHashtags } = settings.tiktok;

  const prompt = `You are an expert true crime scriptwriter for "Brazil Noir" — a YouTube Shorts / TikTok channel that covers real Brazilian criminal cases for English-speaking audiences worldwide.

## Case briefing:
- **Case**: ${topic.topic}
- **Year**: ${topic.year}
- **Location**: ${topic.location}
- **Category**: ${topic.category}
- **Unique angle**: ${topic.angle}
- **Hook**: ${topic.hook}
- **Summary**: ${topic.summary}
- **Key facts**: ${topic.keyFacts?.join(" | ")}
- **The twist**: ${topic.twist}

## Script requirements:
- Duration: ~60 seconds of narration
- Word count: ${wordCount.min}–${wordCount.max} words
- Tone: ${tone}
- Language: English — clear, punchy, accessible (NOT academic)
- CTA: "${cta}"

## Mandatory structure:
1. **HOOK** (0–5s): One sentence. Shocking. No context yet. Drop the audience into the darkest moment.
2. **SETUP** (5–15s): Who are the people. Where. When. Keep it fast.
3. **THE CRIME** (15–35s): What happened. Be specific. Use real details. Build dread.
4. **THE TWIST** (35–50s): The revelation that changes everything. This is the moment.
5. **CTA** (50–60s): "Follow Brazil Noir for more dark stories the world never heard."

## Writing rules:
- Maximum 10 words per sentence
- NO filler words ("basically", "essentially", "actually")
- Use specific numbers, names, dates — they create credibility
- Create silence with line breaks — "\\n" means a dramatic pause
- NEVER say "in this video" or "watch until the end"
- Write like you're whispering a secret directly into someone's ear
- The hook must make someone stop scrolling immediately

## SEO optimization:
- YouTube title: starts with a power word or shocking fact, includes "Brazil" and crime type, max 60 chars
- TikTok title: more conversational, includes key hashtag terms
- Description: first line hooks, mentions Brazil, the case type, and teases the twist

---

Return ONLY valid JSON in this exact format:

{
  "script": "Full narration script with \\n for dramatic pauses.",
  "duration": 60,
  "wordCount": 145,
  "title": {
    "youtube": "YouTube SEO title (max 60 chars, no emoji needed)",
    "tiktok": "TikTok title (max 150 chars, more casual)"
  },
  "description": {
    "youtube": "Full YouTube description (300–500 chars) — hook first, then details, then hashtags",
    "tiktok": "Short TikTok description (100–150 chars) + hashtags"
  },
  "tags": ${JSON.stringify([...defaultTags, ...(topic.keywords || [])])},
  "hashtags": ${JSON.stringify([...defaultHashtags, ...(topic.keywords || []).map((k) => "#" + k.replace(/\s+/g, ""))])},
  "chapters": [
    { "time": "0:00", "label": "Hook" },
    { "time": "0:05", "label": "Setup" },
    { "time": "0:15", "label": "The Crime" },
    { "time": "0:35", "label": "The Twist" },
    { "time": "0:50", "label": "Follow" }
  ],
  "voiceDirections": "Pacing and emphasis instructions for the TTS voice"
}`;

  const response = await client.messages.create({
    model: settings.script.model,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: "You are an expert true crime scriptwriter. You write gripping, cinematic 60-second scripts based on real cases. Always return valid JSON.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b) => b.type === "text")?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude did not return valid JSON for script");

  const script = JSON.parse(match[0]);

  console.log(`   Generating........................ ✓`);
  console.log(`   Words: ${script.wordCount} | Duration: ~${script.duration}s`);
  console.log(`   YouTube title: "${script.title?.youtube}"`);

  return script;
}

// Execução direta
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Teste com caso fictício
  const testTopic = {
    topic: "The Richthofen Case: Brazil's Most Infamous Parricide",
    year: 2002,
    location: "São Paulo, Brazil",
    category: "murder",
    angle: "A wealthy 18-year-old girl who hired her boyfriend to murder her own parents for inheritance",
    hook: "She smiled at her parents' funeral — she had planned every detail.",
    summary: "In 2002, Suzane von Richthofen, 18, convinced her boyfriend and his brother to beat her parents to death in their São Paulo mansion. The motive: R$4 million inheritance.",
    keyFacts: ["She was 18 when she planned the murders", "Her boyfriend and his brother carried out the killings", "She was in the house while it happened"],
    twist: "She was convicted but later became a celebrity in Brazilian media, studied psychology in prison, and became a symbol of the country's broken justice system.",
    keywords: ["richthofen", "brazil murder", "parricide", "true crime brazil", "suzane"],
  };

  generateScript(testTopic)
    .then((s) => console.log(JSON.stringify(s, null, 2)))
    .catch((e) => { console.error("❌ Error:", e.message); process.exit(1); });
}

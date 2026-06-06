/**
 * Módulo 2: Script — Geração de roteiro com Claude API
 *
 * Recebe o tema do módulo 1 e gera:
 * - Roteiro completo narrado (60s)
 * - Título otimizado para SEO
 * - Descrição com timestamps
 * - Tags
 * - Hashtags TikTok
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(
  readFileSync(join(__dirname, "../config/settings.json"), "utf-8")
);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Prompt do roteiro
// ---------------------------------------------------------------------------

function buildScriptPrompt(topic) {
  const { wordCount, tone, cta } = settings.script;
  const { language, targetAudience, style } = settings.niche;
  const { defaultTags } = settings.youtube;
  const { defaultHashtags } = settings.tiktok;

  return `
Você é um roteirista expert em vídeos virais para YouTube Shorts e TikTok.

## Tema escolhido:
- **Título**: ${topic.topic}
- **Categoria**: ${topic.category}
- **Ângulo único**: ${topic.angle}
- **Hook sugerido**: ${topic.hook}
- **Palavras-chave**: ${topic.keywords.join(", ")}

## Requisitos do roteiro:
- Duração: ~60 segundos de narração
- Palavras: ${wordCount.min}–${wordCount.max} palavras
- Tom: ${tone}
- Idioma: ${language}
- Público-alvo: ${targetAudience}
- Estilo: ${style}
- CTA final: "${cta}"

## Estrutura obrigatória:
1. **HOOK** (0–5s): Frase de abertura que prende o espectador IMEDIATAMENTE
2. **CONTEXTO** (5–15s): Informação surpresa que gera curiosidade
3. **DESENVOLVIMENTO** (15–45s): 2–3 fatos fascinantes e verificáveis
4. **CLÍMAX** (45–55s): O fato mais surpreendente / reviravolta
5. **CTA** (55–60s): Call to action para seguir o canal

## Regras de escrita:
- Use linguagem simples e direta
- Evite jargões técnicos sem explicação
- Cada frase deve ter no máximo 12 palavras
- Use números específicos (não "muito" mas "3,7 bilhões")
- Crie suspense e antecipação entre os fatos
- Nunca mencione "vídeo" ou "assista" — fale direto com o ouvinte

---

Retorne APENAS um JSON válido neste formato:

{
  "script": "Texto completo do roteiro para narração. Use \\n para quebras de pausa natural.",
  "duration": 60,
  "wordCount": 140,
  "title": {
    "youtube": "Título SEO para YouTube (máx 60 chars, com emoji inicial)",
    "tiktok": "Título TikTok (máx 150 chars, mais casual)"
  },
  "description": {
    "youtube": "Descrição completa para YouTube (300–500 chars) com hashtags no final",
    "tiktok": "Descrição TikTok curta (100–150 chars) + hashtags"
  },
  "tags": ${JSON.stringify([...defaultTags, ...topic.keywords])},
  "hashtags": ${JSON.stringify([...defaultHashtags, ...topic.keywords.map((k) => "#" + k.replace(/\s+/g, ""))])},
  "chapters": [
    { "time": "0:00", "label": "Hook" },
    { "time": "0:05", "label": "Contexto" },
    { "time": "0:15", "label": "Desenvolvimento" },
    { "time": "0:45", "label": "Clímax" },
    { "time": "0:55", "label": "CTA" }
  ],
  "voiceDirections": "Instruções de entonação para o TTS (pausas, ênfases, ritmo)"
}`;
}

// ---------------------------------------------------------------------------
// Geração do roteiro
// ---------------------------------------------------------------------------

export async function generateScript(topic) {
  console.log(`📝 [Script] Gerando roteiro para: "${topic.topic}"...`);

  const systemPrompt = `Você é um roteirista expert em vídeos virais para YouTube Shorts e TikTok.
Sua especialidade é criar roteiros de 60 segundos que prendem o espectador do início ao fim.
Você sempre retorna JSON válido conforme solicitado, sem texto adicional antes ou depois.`;

  let fullText = "";

  // Streaming para evitar timeout em respostas longas
  const stream = client.messages.stream({
    model: settings.script.model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [{ role: "user", content: buildScriptPrompt(topic) }],
  });

  process.stdout.write("   Gerando");
  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      fullText += chunk.delta.text;
      process.stdout.write(".");
    }
  }
  process.stdout.write(" ✓\n");

  // Extrai JSON
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude não retornou JSON válido no script");

  const result = JSON.parse(match[0]);

  // Injeta metadados do tema
  result.topic = topic;
  result.generatedAt = new Date().toISOString();

  console.log(`✅ [Script] Roteiro gerado!`);
  console.log(`   Título YT: ${result.title.youtube}`);
  console.log(`   Palavras: ${result.wordCount} | Duração estimada: ${result.duration}s`);
  console.log(`\n📜 ROTEIRO:\n${"─".repeat(60)}`);
  console.log(result.script);
  console.log("─".repeat(60));

  return result;
}

// ---------------------------------------------------------------------------
// Execução direta (para testar isoladamente)
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Tema de exemplo para teste
  const testTopic = {
    topic: "A formiga que consegue levantar 5000x o próprio peso",
    category: "natureza",
    angle: "Comparado ao peso humano, seria como levantar 6 caminhões",
    hook: "Existe um animal de 3mm que envergonha qualquer powerlifter do mundo.",
    searchQuery: "ant close up macro nature",
    thumbnailPrompt: "Giant ant lifting a truck, dramatic lighting, photorealistic",
    keywords: ["formigas", "recordes natureza", "animais incríveis", "ciência", "curiosidades"],
    viralScore: 87,
    reasoning: "Conteúdo de natureza + record sempre performa bem",
  };

  generateScript(testTopic)
    .then((s) => {
      console.log("\n📦 JSON completo:");
      console.log(JSON.stringify(s, null, 2));
    })
    .catch((e) => {
      console.error("❌ Erro no script:", e.message);
      process.exit(1);
    });
}

/**
 * Módulo 3: Voice — Geração de áudio com ElevenLabs TTS
 *
 * Recebe o script do módulo 2 e gera o áudio narrado
 * usando a voz configurada no ElevenLabs.
 */

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(
  readFileSync(join(__dirname, "../config/settings.json"), "utf-8")
);

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

// ---------------------------------------------------------------------------
// Geração de áudio
// ---------------------------------------------------------------------------

async function generateAudio(text, outputPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) throw new Error("ELEVENLABS_API_KEY não configurada no .env");
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID não configurada no .env");

  const { stability, similarityBoost, style, speakerBoost } = settings.voice;

  console.log("🎙️  [Voice] Gerando áudio com ElevenLabs...");
  console.log(`   → Voz: ${voiceId}`);
  console.log(`   → Caracteres: ${text.length}`);

  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: speakerBoost,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs API erro ${response.status}: ${err}`);
  }

  const buffer = await response.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));

  const sizeKB = Math.round(buffer.byteLength / 1024);
  console.log(`✅ [Voice] Áudio salvo: ${outputPath} (${sizeKB} KB)`);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Verificar créditos restantes
// ---------------------------------------------------------------------------

async function checkCredits() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${ELEVENLABS_API_URL}/user/subscription`, {
      headers: { "xi-api-key": apiKey },
    });
    const data = await res.json();
    const used = data.character_count || 0;
    const limit = data.character_limit || 0;
    const remaining = limit - used;
    console.log(
      `   → Créditos ElevenLabs: ${remaining.toLocaleString()} / ${limit.toLocaleString()} caracteres restantes`
    );
    return remaining;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function generateVoice(scriptData, outputDir) {
  // Garante que o diretório de saída existe
  mkdirSync(outputDir, { recursive: true });

  const audioPath = join(outputDir, "narration.mp3");

  // Verifica créditos antes de gastar
  await checkCredits();

  // Usa o script completo gerado pelo módulo 2
  const text = scriptData.script;

  if (!text || text.trim().length === 0) {
    throw new Error("Script vazio — rode o módulo 2 primeiro");
  }

  await generateAudio(text, audioPath);

  const durationEstimate = Math.round(text.length / 15); // ~15 chars/segundo em PT-BR
  console.log(`   → Duração estimada: ~${durationEstimate}s`);

  return {
    audioPath,
    duration: durationEstimate,
    characters: text.length,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
  };
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/3-voice.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Script de teste
  const testScript = {
    script:
      "Existe um sinal que entrega quando alguém está mentindo — e você usa toda hora sem perceber. " +
      "Neurocientistas da Universidade de Harvard descobriram que o cérebro humano processa microexpressões " +
      "em menos de 200 milissegundos. São expressões faciais involuntárias que duram apenas um flash. " +
      "Você não percebe conscientemente, mas seu instinto sente. " +
      "Quando alguém mente, três regiões do rosto trair a verdade: os olhos, a boca e as sobrancelhas. " +
      "O sorriso falso nunca atinge os olhos. As sobrancelhas sobem de forma assimétrica. " +
      "A boca sorri, mas o queixo trai. Agora você pode usar isso no dia a dia. " +
      "Observe os olhos de quem fala com você. Se o sorriso não chega até as pupilas, desconfie. " +
      "Quer aprender a ler qualquer pessoa? O método completo está no link da bio.",
  };

  const outputDir = join(__dirname, "../output/test-voice");

  generateVoice(testScript, outputDir)
    .then((result) => {
      console.log("\n📦 Resultado:");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((e) => {
      console.error("❌ Erro no voice:", e.message);
      process.exit(1);
    });
}

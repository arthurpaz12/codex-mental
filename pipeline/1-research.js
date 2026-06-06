/**
 * Módulo 1: Research — Busca de trending topics
 *
 * Combina Google Trends + YouTube Trending + análise histórica
 * para escolher o melhor tema do dia para o canal.
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
// Fontes de dados trending
// ---------------------------------------------------------------------------

async function fetchYouTubeTrending() {
  // YouTube Data API v3 — vídeos em alta no Brasil
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_CLIENT_ID;
  if (!apiKey) return [];

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=BR&videoCategoryId=27&maxResults=10&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    return (data.items || []).map((v) => ({
      title: v.snippet.title,
      views: parseInt(v.statistics.viewCount || "0"),
      category: v.snippet.categoryId,
    }));
  } catch {
    return [];
  }
}

async function fetchGoogleTrends() {
  // Google Trends (scraping básico do RSS público)
  try {
    const res = await fetch(
      "https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR"
    );
    const xml = await res.text();
    const titles = [...xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]>/g)].map(
      (m) => m[1]
    );
    return titles.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchRedditTrending() {
  // Posts em alta de subreddits de curiosidades
  const subreddits = ["todayilearned", "interestingasfuck", "science"];
  const results = [];

  for (const sub of subreddits) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/hot.json?limit=5`,
        { headers: { "User-Agent": "auto-content-bot/1.0" } }
      );
      const data = await res.json();
      const posts = (data.data?.children || []).map((p) => ({
        title: p.data.title,
        score: p.data.score,
        subreddit: sub,
      }));
      results.push(...posts);
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Análise com Claude
// ---------------------------------------------------------------------------

async function selectBestTopic(trends) {
  const { categories, language, targetAudience, style } = settings.niche;

  const systemPrompt = readFileSync(
    join(__dirname, "../prompts/system-research.md"),
    "utf-8"
  ).catch
    ? `Você é um estrategista de conteúdo especializado em canais faceless do YouTube.
Seu objetivo é escolher o melhor tema do dia que maximize visualizações e engajamento.`
    : readFileSync(join(__dirname, "../prompts/system-research.md"), "utf-8");

  const userMessage = `
Dados de trending hoje (${new Date().toLocaleDateString("pt-BR")}):

## YouTube Trending (BR):
${JSON.stringify(trends.youtube, null, 2)}

## Google Trends (BR):
${JSON.stringify(trends.google, null, 2)}

## Reddit (posts virais):
${JSON.stringify(trends.reddit, null, 2)}

---

Canal: ${settings.niche.name}
Categorias aceitas: ${categories.join(", ")}
Idioma: ${language}
Público: ${targetAudience}
Estilo: ${style}

Escolha o MELHOR tema para um vídeo de 60 segundos hoje.
Retorne APENAS um JSON válido neste formato:

{
  "topic": "título do tema escolhido",
  "category": "categoria (ciência|história|natureza|animais|recordes)",
  "angle": "ângulo único e surpreendente para abordar o tema",
  "hook": "frase de abertura impactante (máx 15 palavras)",
  "searchQuery": "query para buscar mídia no Pexels",
  "thumbnailPrompt": "descrição visual para gerar thumbnail no DALL-E",
  "keywords": ["palavra1", "palavra2", "palavra3", "palavra4", "palavra5"],
  "viralScore": 0-100,
  "reasoning": "por que este tema vai bombar hoje",
  "hotmartProduct": "O Código da Leitura Mental | A Arte da Sedução",
  "hotmartCta": "CTA natural para o produto escolhido"
}`;

  const response = await client.messages.create({
    model: settings.script.model,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: `Você é um estrategista de conteúdo especializado em canais faceless do YouTube.
Seu objetivo é escolher o melhor tema do dia que maximize visualizações e engajamento.
Categorias do canal: ${categories.join(", ")}.
Sempre retorne JSON válido conforme solicitado.`,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content.find((b) => b.type === "text")?.text || "";

  // Extrai JSON da resposta
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude não retornou JSON válido");

  return JSON.parse(match[0]);
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function runResearch() {
  console.log("🔍 [Research] Buscando trending topics...");

  const [youtube, google, reddit] = await Promise.all([
    fetchYouTubeTrending(),
    fetchGoogleTrends(),
    fetchRedditTrending(),
  ]);

  console.log(
    `   → YouTube: ${youtube.length} vídeos | Google: ${google.length} trends | Reddit: ${reddit.length} posts`
  );

  const topic = await selectBestTopic({ youtube, google, reddit });

  console.log(`✅ [Research] Tema selecionado: "${topic.topic}"`);
  console.log(`   Viral score: ${topic.viralScore}/100 | Categoria: ${topic.category}`);
  console.log(`   Ângulo: ${topic.angle}`);

  return topic;
}

// Execução direta
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runResearch()
    .then((t) => {
      console.log("\n📦 Resultado completo:");
      console.log(JSON.stringify(t, null, 2));
    })
    .catch((e) => {
      console.error("❌ Erro no research:", e.message);
      process.exit(1);
    });
}

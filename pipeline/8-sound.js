/**
 * Módulo 8: Sound — Sugestão diária de som/áudio para o TikTok
 *
 * O TikTok Content Posting API NÃO permite anexar um som de catálogo
 * via upload programático — o áudio precisa ser escolhido manualmente
 * no app (ou futuramente via TikTok Research API quando aprovada).
 *
 * Este módulo resolve isso de forma automatizada-assistida: rotaciona
 * entre as categorias curadas em config/tiktok-sounds.json e gera uma
 * sugestão do dia (categoria + som + dica de busca), salva junto ao
 * output do run, para orientar rapidamente a escolha na hora de postar.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function dayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function loadSoundsConfig() {
  const path = join(__dirname, "../config/tiktok-sounds.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Escolhe a categoria e o som do dia via rotação round-robin determinística
 * baseada no dia do ano — garante variedade sem precisar de estado salvo.
 */
function pickDailySound(config, date = new Date()) {
  const categoryNames = Object.keys(config.categories);
  if (categoryNames.length === 0) {
    throw new Error("Nenhuma categoria de som configurada em tiktok-sounds.json");
  }

  const doy = dayOfYear(date);

  // Rotaciona a categoria pelo dia do ano
  const categoryName = categoryNames[doy % categoryNames.length];
  const sounds = config.categories[categoryName];

  // Dentro da categoria, rotaciona o som também (offset diferente para não sincronizar)
  const sound = sounds[Math.floor(doy / categoryNames.length) % sounds.length];

  return { categoryName, sound };
}

/**
 * Export principal — gera a sugestão de som do dia
 */
export async function suggestSound(outputDir) {
  console.log("🎵 [Sound] Gerando sugestão de som para o TikTok...");

  const config = loadSoundsConfig();
  const { categoryName, sound } = pickDailySound(config);

  const suggestion = {
    date: new Date().toISOString().slice(0, 10),
    category: categoryName,
    sound: sound.name,
    searchHint: sound.searchHint,
    tip: sound.tip,
    instructions: config.instructions?.fluxo_recomendado || [],
  };

  console.log(`   → Categoria do dia: ${categoryName}`);
  console.log(`   → Som sugerido: ${sound.name}`);
  console.log(`   → Dica de busca: ${sound.searchHint}`);
  console.log(`   → Use: ${sound.tip}`);
  console.log("✅ [Sound] Sugestão gerada — escolha o som manualmente ao publicar no TikTok");

  return suggestion;
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/8-sound.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  suggestSound()
    .then((result) => {
      console.log("\n📦 Resultado:");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((e) => {
      console.error("❌ Erro no sound:", e.message);
      process.exit(1);
    });
}

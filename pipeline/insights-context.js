/**
 * Helper compartilhado: lê dashboard/insights.json (gerado pelo módulo 13)
 * e monta um pequeno bloco de contexto em texto, pronto para injetar nos
 * prompts de seleção de tema (1-research) e geração de roteiro/SEO (2-script).
 *
 * Mantém a geração de conteúdo "orientada por dados reais": em vez de só
 * seguir boas práticas genéricas de SEO, a IA passa a saber o que De Fato
 * já performou bem neste canal (categorias, plataformas, horários, padrões
 * de título/tema) e pode replicar/iterar sobre isso.
 *
 * Retorna string vazia se ainda não há insights suficientes — assim os
 * prompts continuam funcionando normalmente desde o primeiro uso do canal.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSIGHTS_PATH = join(__dirname, "../dashboard/insights.json");

function fmtN(n) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));
}

export function loadPerformanceContext({ maxTopVideos = 3 } = {}) {
  if (!existsSync(INSIGHTS_PATH)) return "";

  let insights;
  try {
    insights = JSON.parse(readFileSync(INSIGHTS_PATH, "utf-8"));
  } catch {
    return "";
  }

  if (!insights || !insights.sampleSize || insights.sampleSize === 0) return "";

  const lines = [];
  lines.push(`## Dados reais de performance do canal (${insights.sampleSize} vídeo(s) analisados):`);

  if (insights.byCategory?.length) {
    lines.push(
      `- Categorias com melhor desempenho médio: ` +
        insights.byCategory
          .slice(0, 3)
          .map((c) => `${c.key} (média ${fmtN(c.avgViews)} views, ${c.avgEngagement}% engajamento)`)
          .join("; ")
    );
  }

  if (insights.byPlatform?.length) {
    lines.push(
      `- Plataformas com melhor desempenho médio: ` +
        insights.byPlatform.map((p) => `${p.key} (média ${fmtN(p.avgViews)} views)`).join("; ")
    );
  }

  if (insights.topByViews?.length) {
    lines.push(
      `- Temas que mais geraram views até agora: ` +
        insights.topByViews
          .slice(0, maxTopVideos)
          .map((v) => `"${v.topic}" (${fmtN(v.views)} views, categoria ${v.category})`)
          .join("; ")
    );
  }

  if (insights.topByEngagement?.length) {
    lines.push(
      `- Temas com melhor engajamento (curtidas+comentários/views): ` +
        insights.topByEngagement
          .slice(0, maxTopVideos)
          .map((v) => `"${v.topic}" (${v.engagement}%)`)
          .join("; ")
    );
  }

  if (insights.byHourUTC?.length) {
    lines.push(`- Horário (UTC) com maior engajamento médio: ${insights.byHourUTC[0].key}`);
  }

  if (typeof insights.viralScoreCorrelation === "number") {
    lines.push(
      `- Correlação entre o "viralScore" estimado e o resultado real: ${insights.viralScoreCorrelation} ` +
        `(escala -1 a 1; quanto mais perto de 1, mais confiável é a estimativa)`
    );
  }

  if (insights.recommendations?.length) {
    lines.push(`- Recomendações já identificadas: ${insights.recommendations.join(" | ")}`);
  }

  lines.push(
    `\nUse esses dados como referência real do que já funcionou neste canal — prefira temas, ` +
      `ângulos e formatos parecidos com os que mais performaram, mas sem repetir os mesmos temas.`
  );

  return lines.join("\n");
}

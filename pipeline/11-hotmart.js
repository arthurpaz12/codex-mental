/**
 * Módulo 11: Hotmart — Receita real via Hotmart API
 *
 * Busca o resumo de vendas (faturamento, nº de vendas) na Sales API
 * da Hotmart e atualiza dashboard/data.json com os números reais,
 * substituindo a estimativa baseada em "vídeos publicados × valor fixo".
 *
 * Requer credenciais OAuth2 (Client Credentials) geradas em:
 *   Hotmart > Ferramentas > Hotmart Developers > Credenciais
 *
 * Variáveis necessárias no .env:
 *   HOTMART_CLIENT_ID
 *   HOTMART_CLIENT_SECRET
 *   HOTMART_BASIC_TOKEN     (Basic <base64(client_id:client_secret)> — gerado no painel)
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "../dashboard/data.json");

const AUTH_URL = "https://api-sec-vlc.hotmart.com/security/oauth/token";
const SALES_SUMMARY_URL = "https://developers.hotmart.com/payments/api/v1/sales/summary";
const SALES_HISTORY_URL = "https://developers.hotmart.com/payments/api/v1/sales/history";

// ---------------------------------------------------------------------------
// Autenticação OAuth2 (Client Credentials)
// ---------------------------------------------------------------------------

async function getAccessToken() {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basicToken = process.env.HOTMART_BASIC_TOKEN;

  if (!clientId || !clientSecret || !basicToken) {
    return null;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${AUTH_URL}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: basicToken.startsWith("Basic ") ? basicToken : `Basic ${basicToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hotmart auth erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Resumo de vendas (período: últimos 30 dias)
// ---------------------------------------------------------------------------

async function fetchSalesSummary(accessToken) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const params = new URLSearchParams({
    start_date: String(thirtyDaysAgo),
    end_date: String(now),
  });

  const res = await fetch(`${SALES_SUMMARY_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hotmart sales summary erro ${res.status}: ${err}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Histórico de vendas (últimos 30 dias) — usado para agregar por produto
// ---------------------------------------------------------------------------

async function fetchSalesByProduct(accessToken) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const byProduct = {}; // id -> { id, name, sales, revenue, currency }
  let pageToken = null;
  let pages = 0;
  const MAX_PAGES = 20; // proteção contra loop infinito / contas com muito histórico

  do {
    const params = new URLSearchParams({
      start_date: String(thirtyDaysAgo),
      end_date: String(now),
      max_results: "100",
    });
    if (pageToken) params.set("page_token", pageToken);

    const res = await fetch(`${SALES_HISTORY_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Hotmart sales history erro ${res.status}: ${err}`);
    }

    const json = await res.json();
    const items = json.items || json.data || [];

    for (const item of items) {
      const product = item.product || item.subscription?.product || {};
      const id = product.id ?? product.ucode ?? product.name ?? "desconhecido";
      const name = product.name ?? "Produto desconhecido";

      const price = item.purchase?.price ?? item.purchase?.full_price ?? {};
      const value = price.value ?? price.amount ?? 0;
      const currency = price.currency_value ?? price.currency_code ?? "BRL";

      byProduct[id] = byProduct[id] || { id, name, sales: 0, revenue: 0, currency };
      byProduct[id].sales += 1;
      byProduct[id].revenue += Number(value) || 0;
    }

    pageToken = json.page_info?.next_page_token || json.page_info?.nextPageToken || null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return Object.values(byProduct).sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

export async function refreshHotmartRevenue() {
  console.log("💰 [Hotmart] Buscando dados reais de vendas...");

  const clientId = process.env.HOTMART_CLIENT_ID;
  if (!clientId) {
    console.log("   ⚠️  Credenciais Hotmart não configuradas — mantendo estimativa no dashboard");
    console.log("   → Gere em: Hotmart > Ferramentas > Hotmart Developers > Credenciais");
    console.log("   → Adicione HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET e HOTMART_BASIC_TOKEN ao .env");
    return null;
  }

  try {
    const accessToken = await getAccessToken();
    const summary = await fetchSalesSummary(accessToken);

    // A resposta varia conforme a versão da API — tentamos os campos mais comuns
    const totalRevenue = summary.total_value ?? summary.totalValue ?? summary.sum_value ?? 0;
    const totalSales = summary.total_sales ?? summary.totalSales ?? summary.sum_sales ?? 0;
    const currency = summary.currency_code ?? summary.currencyCode ?? "BRL";

    // Busca o detalhamento por produto (best-effort — não quebra se falhar)
    let byProduct = [];
    try {
      byProduct = await fetchSalesByProduct(accessToken);
    } catch (e) {
      console.warn(`   ⚠️  Não foi possível detalhar vendas por produto: ${e.message}`);
    }

    if (!existsSync(DATA_PATH)) {
      console.warn("   ⚠️  dashboard/data.json não encontrado — rode o módulo 9 primeiro");
      return null;
    }

    const data = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
    data.hotmart = {
      source: "api",
      revenueLast30Days: totalRevenue,
      salesLast30Days: totalSales,
      currency,
      byProduct,
      updatedAt: new Date().toISOString(),
    };
    data.lastUpdated = new Date().toISOString();
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

    console.log(`   → Vendas (30 dias): ${totalSales}`);
    console.log(`   → Faturamento (30 dias): ${totalRevenue} ${currency}`);
    if (byProduct.length) {
      console.log("   → Por produto:");
      byProduct.forEach((p) => console.log(`      • ${p.name}: ${p.sales} venda(s), ${p.revenue} ${p.currency}`));
    }
    console.log("✅ [Hotmart] Dashboard atualizado com dados reais");

    return data.hotmart;
  } catch (e) {
    console.warn(`   ⚠️  Falha ao buscar dados da Hotmart: ${e.message}`);
    console.warn("   → Mantendo estimativa no dashboard");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Execução direta: node pipeline/11-hotmart.js
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refreshHotmartRevenue()
    .then((r) => console.log("\n📦 Resultado:", JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error("❌ Erro no Hotmart:", e.message);
      process.exit(1);
    });
}

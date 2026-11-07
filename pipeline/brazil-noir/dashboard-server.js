/**
 * Brazil Noir — servidor local da dashboard v2
 *
 * Serve a pasta dashboard/ (a mesma que vai pra Vercel) e adiciona uma API
 * pequena para a página gravar gastos em dashboard/brazil-noir/spend.json.
 * Na Vercel a página é estática: lá a API não existe e o formulário avisa.
 *
 * Só escuta em 127.0.0.1 e só aceita escrita vinda da própria página
 * (Host/Origin locais + JSON), para nenhum site de fora gravar no arquivo.
 *
 * Uso:  node pipeline/brazil-noir/dashboard-server.js   →  http://127.0.0.1:8099/brazil-noir/
 */

import { createServer } from "http";
import { spawn } from "child_process";
import { readFile, writeFile, rename } from "fs/promises";
import { join, extname, resolve, sep, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../dashboard");
const SPEND_PATH = join(ROOT, "brazil-noir", "spend.json");
const PORT = Number(process.env.BN_DASHBOARD_PORT || 8099);
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
};
const CATEGORIES = ["impulsionamento", "ferramenta", "outro"];
const PLATFORMS = ["tiktok", "youtube", "instagram"];
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const DATA_PATH = join(ROOT, "brazil-noir", "data.json");
const COLLECTOR = join(__dirname, "analytics.js");
const COLLECT_EVERY_MS = 6 * 3600 * 1000;
const YT_REFERER = "https://codex-mental.vercel.app/";
const YT_ENDPOINTS = new Set(["channels", "playlistItems", "videos"]);

// Chave pública do YouTube: do .env se houver, senão a mesma que a página já usa
let ytKeyCache;
async function ytKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  if (ytKeyCache === undefined) {
    const html = await readFile(join(ROOT, "brazil-noir", "index.html"), "utf-8").catch(() => "");
    ytKeyCache = /const YOUTUBE_API_KEY = "(AIza[\w-]+)"/.exec(html)?.[1] || null;
  }
  return ytKeyCache;
}

// Roda o coletor (analytics.js): grava um ponto do dia em data.json
let lastCollect = null, collecting = false;
async function runCollector(reason) {
  if (collecting) return;
  const key = await ytKey();
  collecting = true;
  console.log(`↻ coletando métricas (${reason})`);
  const child = spawn(process.execPath, [COLLECTOR], { cwd: resolve(__dirname, "../.."), env: { ...process.env, ...(key && { YOUTUBE_API_KEY: key }) }, stdio: "ignore", windowsHide: true });
  child.on("exit", (code) => { collecting = false; lastCollect = { at: new Date().toISOString(), ok: code === 0 }; console.log(`↻ coleta terminou (código ${code})`); });
  child.on("error", () => { collecting = false; });
}
async function collectIfStale(reason) {
  try {
    const { generatedAt } = JSON.parse(await readFile(DATA_PATH, "utf-8"));
    if (generatedAt && Date.now() - new Date(generatedAt) < COLLECT_EVERY_MS) return;
  } catch {}
  runCollector(reason);
}

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

// ---------------------------------------------------------------------------
// spend.json
// ---------------------------------------------------------------------------

async function loadSpend() {
  const data = JSON.parse(await readFile(SPEND_PATH, "utf-8"));
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  // Lançamentos antigos (editados à mão) ganham id para poderem ser editados pela página
  let changed = false;
  for (const e of data.entries) if (!e.id) { e.id = randomUUID().slice(0, 8); changed = true; }
  if (changed) await saveSpend(data);
  return data;
}

async function saveSpend(data) {
  data.entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const tmp = SPEND_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, SPEND_PATH); // grava inteiro ou nada
}

const num = (v) => (v === "" || v == null ? null : Number(v));

function cleanEntry(input) {
  const e = {
    date: String(input.date || "").slice(0, 10),
    category: CATEGORIES.includes(input.category) ? input.category : "outro",
    item: String(input.item || "").trim().slice(0, 120),
    note: String(input.note || "").trim().slice(0, 200) || null,
    amount: num(input.amount),
    platform: PLATFORMS.includes(input.platform) ? input.platform : null,
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error("Data inválida");
  if (!e.item) throw new Error("Informe o item");
  if (!(e.amount > 0) || e.amount > 1e6) throw new Error("Valor inválido");
  e.amount = Math.round(e.amount * 100) / 100;
  if (input.videoId) e.videoId = String(input.videoId).slice(0, 64);
  const views = num(input.results?.views), followers = num(input.results?.followers);
  if (e.category === "impulsionamento" && (views != null || followers != null)) {
    if ((views != null && !(views >= 0)) || (followers != null && !(followers >= 0))) throw new Error("Resultado inválido");
    e.results = { views: views != null ? Math.round(views) : null, followers: followers != null ? Math.round(followers) : null };
  }
  return e;
}

// Escrita só da própria página: Host local, Origin local (se vier) e corpo JSON
function writeAllowed(req) {
  if (!LOCAL_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ""))) return false;
  return (req.headers["content-type"] || "").startsWith("application/json");
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new Error("Corpo muito grande");
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
}

async function api(req, res, path) {
  if (path === "/api/brazil-noir/health") return send(res, 200, { ok: true, writable: true, youtubeProxy: !!(await ytKey()), lastCollect, collecting });

  // Repasse para a YouTube Data API com o referer liberado na chave
  const yt = /^\/api\/brazil-noir\/yt\/(\w+)$/.exec(path);
  if (yt) {
    if (req.method !== "GET" || !YT_ENDPOINTS.has(yt[1])) return send(res, 404, { error: "Não encontrado" });
    const key = await ytKey();
    if (!key) return send(res, 503, { error: "Sem chave do YouTube" });
    const params = new URL(req.url, "http://x").searchParams;
    params.set("key", key);
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/${yt[1]}?${params}`, { headers: { Referer: YT_REFERER } });
      return send(res, r.status, await r.text());
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }

  const m = /^\/api\/brazil-noir\/spend(?:\/([\w-]+))?$/.exec(path);
  if (!m) return send(res, 404, { error: "Não encontrado" });
  const id = m[1];

  if (req.method === "GET" && !id) return send(res, 200, await loadSpend());
  if (!["POST", "PUT", "DELETE"].includes(req.method)) return send(res, 405, { error: "Método não suportado" });
  if (!writeAllowed(req)) return send(res, 403, { error: "Escrita permitida só pela página local" });

  try {
    const data = await loadSpend();
    if (req.method === "POST" && !id) {
      const entry = { id: randomUUID().slice(0, 8), ...cleanEntry(await readBody(req)) };
      data.entries.push(entry);
      await saveSpend(data);
      console.log(`+ gasto ${entry.date} ${entry.item} R$ ${entry.amount}`);
      return send(res, 201, entry);
    }
    const idx = data.entries.findIndex((e) => e.id === id);
    if (!id || idx < 0) return send(res, 404, { error: "Lançamento não encontrado" });
    if (req.method === "PUT") {
      data.entries[idx] = { id, ...cleanEntry(await readBody(req)) };
      await saveSpend(data);
      console.log(`~ gasto ${id} atualizado`);
      return send(res, 200, data.entries[idx]);
    }
    const [removed] = data.entries.splice(idx, 1);
    await saveSpend(data);
    console.log(`- gasto ${removed.date} ${removed.item}`);
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Arquivos estáticos
// ---------------------------------------------------------------------------

async function serveStatic(req, res, path) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Método não suportado", "text/plain");
  let file = resolve(ROOT, "." + path);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, "Proibido", "text/plain");
  if (path.endsWith("/")) file = join(file, "index.html");
  else if (!extname(file)) {
    // /brazil-noir → /brazil-noir/ (os caminhos relativos da página dependem da barra)
    try { await readFile(join(file, "index.html")); res.writeHead(301, { Location: path + "/" }); return res.end(); } catch {}
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, "Não encontrado", "text/plain; charset=utf-8");
  }
}

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") { res.writeHead(302, { Location: "/brazil-noir/" }); return res.end(); }
    if (path.startsWith("/api/")) return await api(req, res, path);
    return await serveStatic(req, res, path);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`Dashboard do Brazil Noir em http://${HOST}:${PORT}/brazil-noir/`);
  // Mantém o histórico diário andando enquanto o servidor estiver ligado
  collectIfStale("início");
  setInterval(() => collectIfStale("agendada"), 30 * 60 * 1000).unref?.();
});

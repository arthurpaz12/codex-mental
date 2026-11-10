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
const REPO = resolve(ROOT, "..");
const EPISODES = join(REPO, "longform", "episodes");
const SCHEDULER = join(__dirname, "youtube-schedule.js");
// O que veio do planejamento/upload e o formulário da página não edita: fica preservado
const SCHEDULE_KEEP = ["yt", "description", "tags", "caption", "hashtags", "credits", "episodeRef", "thumbnail", "syntheticMedia", "status"];

// Credenciais do YouTube presentes no .env? (só checa os nomes, nunca expõe valores)
async function youtubeReady() {
  const env = await readFile(join(REPO, ".env"), "utf-8").catch(() => "");
  return ["BN_YOUTUBE_CLIENT_ID", "BN_YOUTUBE_CLIENT_SECRET", "BN_YOUTUBE_REFRESH_TOKEN"].every((k) => new RegExp(`^${k}=.+`, "m").test(env));
}

// Roda o youtube-schedule.js e devolve a saída
function runScheduler(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCHEDULER, ...args], { cwd: REPO, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => done({ ok: code === 0, log: out.replace(/\r[^\n]*/g, "").trim() }));
    child.on("error", (e) => done({ ok: false, log: e.message }));
  });
}

// Episódios prontos em longform/episodes (pasta com .mp4 e youtube.txt)
async function listEpisodes() {
  const { readdir, stat } = await import("fs/promises");
  const out = [];
  for (const d of (await readdir(EPISODES).catch(() => [])).sort()) {
    const dir = join(EPISODES, d);
    if (!(await stat(dir)).isDirectory()) continue;
    const files = await readdir(dir);
    const video = files.find((f) => /\.mp4$/i.test(f));
    const shorts = (await readdir(join(dir, "shorts")).catch(() => [])).filter((f) => /\.mp4$/i.test(f)).sort();
    const yt = files.includes("youtube.txt") ? await readFile(join(dir, "youtube.txt"), "utf-8").catch(() => "") : "";
    const title = /^TITLE:\s*\n(.+)/m.exec(yt)?.[1].trim() || null;
    out.push({ id: d, title, ready: !!video && !!yt, video: video ? `longform/episodes/${d}/${video}` : null, shorts: shorts.map((f) => `longform/episodes/${d}/shorts/${f}`) });
  }
  return out;
}
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

const num = (v) => (v === "" || v == null ? null : Number(v));
const text = (v, max) => String(v ?? "").trim().slice(0, max) || null;

// Coleções editáveis pela página: gastos e vídeos programados
const COLLECTIONS = {
  spend: {
    path: SPEND_PATH,
    label: "gasto",
    clean: (input) => cleanEntry(input),
    order: (a, b) => (b.date || "").localeCompare(a.date || ""),
    fresh: { _leia: "Gastos do Brazil Noir, em reais. Lançados pela dashboard (servidor local) ou à mão.", currency: "BRL", entries: [] },
  },
  schedule: {
    path: join(ROOT, "brazil-noir", "schedule.json"),
    label: "programado",
    clean: (input) => cleanSchedule(input),
    order: (a, b) => (a.at || "").localeCompare(b.at || ""),
    fresh: {
      _leia: "Vídeos programados do Brazil Noir (YouTube Studio, TikTok, Reels). Lançados pela dashboard (servidor local) ou à mão. at = data e hora local (AAAA-MM-DDTHH:MM). platforms: yt_long | yt_shorts | tiktok | reels. kind: corte | episodio. Quando o vídeo sai com o mesmo título, a dashboard marca como publicado sozinha.",
      entries: [],
    },
  },
};

async function loadColl(name) {
  const c = COLLECTIONS[name];
  let data;
  try { data = JSON.parse(await readFile(c.path, "utf-8")); } catch { data = structuredClone(c.fresh); }
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  // Lançamentos editados à mão ganham id para poderem ser editados pela página
  let changed = false;
  for (const e of data.entries) if (!e.id) { e.id = randomUUID().slice(0, 8); changed = true; }
  if (changed) await saveColl(name, data);
  return data;
}

async function saveColl(name, data) {
  const c = COLLECTIONS[name];
  data.entries.sort(c.order);
  const tmp = c.path + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, c.path); // grava inteiro ou nada
}

const SCHED_PLATS = ["yt_long", "yt_shorts", "tiktok", "reels"];
function cleanSchedule(input) {
  const e = {
    at: String(input.at || "").slice(0, 16),
    title: text(input.title, 140),
    platforms: [...new Set(Array.isArray(input.platforms) ? input.platforms : [])].filter((p) => SCHED_PLATS.includes(p)),
    kind: input.kind === "episodio" ? "episodio" : "corte",
    case: text(input.case, 80),
    note: text(input.note, 200),
  };
  const file = text(input.file, 300);
  if (file) {
    const abs = resolve(REPO, file);
    if (!abs.startsWith(EPISODES + sep) || !/\.mp4$/i.test(abs)) throw new Error("Arquivo de vídeo inválido");
    e.file = file;
  }
  if (["rascunho", "aprovado"].includes(input.status)) e.status = input.status;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.at)) throw new Error("Data e hora inválidas");
  if (!e.title) throw new Error("Informe o título");
  if (!e.platforms.length) throw new Error("Escolha pelo menos uma rede");
  return e;
}

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
  if (path === "/api/brazil-noir/health") return send(res, 200, { ok: true, writable: true, youtubeProxy: !!(await ytKey()), youtubeUpload: await youtubeReady(), lastCollect, collecting });

  if (path === "/api/brazil-noir/episodes" && req.method === "GET") return send(res, 200, await listEpisodes());

  // Planejar episódio (cria rascunhos) e aprovar + subir um item da agenda para o YouTube
  const ytAct = /^\/api\/brazil-noir\/(plan|schedule\/([\w-]+)\/youtube)$/.exec(path);
  if (ytAct) {
    if (req.method !== "POST") return send(res, 405, { error: "Método não suportado" });
    if (!writeAllowed(req)) return send(res, 403, { error: "Escrita permitida só pela página local" });
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
    if (ytAct[1] === "plan") {
      if (!/^[\w-]+$/.test(body.episode || "") || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.at || "")) return send(res, 400, { error: "Escolha o episódio e o horário" });
      const args = ["plan", body.episode, "--at", body.at.replace("T", " ")];
      if (/^\d{2}:\d{2}$/.test(body.shortsTime || "")) args.push("--shorts-time", body.shortsTime);
      const r = await runScheduler(args);
      return send(res, r.ok ? 200 : 400, r.ok ? r : { error: r.log });
    }
    if (!(await youtubeReady())) return send(res, 409, { error: "Falta autorizar o YouTube neste computador (npm run bn:youtube:auth)" });
    const id = ytAct[2];
    const ap = await runScheduler(["approve", id]);
    if (!ap.ok) return send(res, 400, { error: ap.log });
    console.log(`↑ subindo ${id} para o YouTube`);
    const up = await runScheduler(["upload", id]);
    return send(res, up.ok ? 200 : 400, up.ok ? up : { error: up.log });
  }

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

  const m = /^\/api\/brazil-noir\/(spend|schedule)(?:\/([\w-]+))?$/.exec(path);
  if (!m) return send(res, 404, { error: "Não encontrado" });
  const [, name, id] = m;
  const coll = COLLECTIONS[name];

  if (req.method === "GET" && !id) return send(res, 200, await loadColl(name));
  if (!["POST", "PUT", "DELETE"].includes(req.method)) return send(res, 405, { error: "Método não suportado" });
  if (!writeAllowed(req)) return send(res, 403, { error: "Escrita permitida só pela página local" });

  try {
    const data = await loadColl(name);
    if (req.method === "POST" && !id) {
      const entry = { id: randomUUID().slice(0, 8), ...coll.clean(await readBody(req)) };
      data.entries.push(entry);
      await saveColl(name, data);
      console.log(`+ ${coll.label} ${entry.id}`);
      return send(res, 201, entry);
    }
    const idx = data.entries.findIndex((e) => e.id === id);
    if (!id || idx < 0) return send(res, 404, { error: "Lançamento não encontrado" });
    if (req.method === "PUT") {
      const prev = data.entries[idx];
      const kept = name === "schedule" ? Object.fromEntries(SCHEDULE_KEEP.filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]])) : {};
      const next = coll.clean(await readBody(req));
      if (name === "schedule" && !next.file && prev.file) next.file = prev.file;
      data.entries[idx] = { id, ...kept, ...next };
      await saveColl(name, data);
      console.log(`~ ${coll.label} ${id} atualizado`);
      return send(res, 200, data.entries[idx]);
    }
    data.entries.splice(idx, 1);
    await saveColl(name, data);
    console.log(`- ${coll.label} ${id}`);
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

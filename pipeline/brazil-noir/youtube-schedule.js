/**
 * Brazil Noir — agenda e sobe episódios e cortes no YouTube
 *
 * Trabalha em cima da agenda da dashboard (dashboard/brazil-noir/schedule.json):
 *
 *   plan <ep> --at "AAAA-MM-DD HH:MM" [--shorts-time HH:MM] [--gap DIAS]
 *       Cria na agenda, como RASCUNHO, o episódio longo (no horário dado) e os
 *       3 cortes (um por dia depois do episódio). Título, descrição e tags vêm
 *       do youtube.txt e do shorts/postagem.txt do episódio em longform/episodes.
 *       <ep> pode ser "ep02", "2" ou o nome da pasta.
 *
 *   approve <id...>      marca como aprovado (depois da revisão)
 *   upload <id...> [--dry-run]
 *       Sobe para o YouTube como PRIVADO com data de publicação = horário da
 *       agenda; o YouTube publica sozinho na hora. Só sobe o que está aprovado.
 *       --dry-run confere tudo e mostra o que seria enviado, sem enviar.
 *   list                 mostra a agenda com o status de cada item
 *
 * TikTok e Reels ficam na agenda como lembrete (as APIs deles não agendam).
 * Credenciais no .env: BN_YOUTUBE_CLIENT_ID, BN_YOUTUBE_CLIENT_SECRET e
 * BN_YOUTUBE_REFRESH_TOKEN (gerado por `npm run bn:youtube:auth`).
 * Cota da API: cada vídeo custa 1.600 de 10.000 unidades/dia (~6 vídeos por dia).
 */

import "dotenv/config";
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { join, dirname, resolve, relative, sep } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const EPISODES = join(REPO, "longform", "episodes");
const SCHEDULE_PATH = process.env.BN_SCHEDULE_PATH || join(REPO, "dashboard", "brazil-noir", "schedule.json");
const CATEGORY_ID = "24"; // Entretenimento
const CHUNK = 16 * 1024 * 1024; // múltiplo de 256 KB, exigência do upload em partes

// ---------------------------------------------------------------------------
// Agenda (mesmo arquivo que a dashboard edita)
// ---------------------------------------------------------------------------

function loadSchedule() {
  const fresh = { _leia: "Vídeos programados do Brazil Noir. Ver pipeline/brazil-noir/youtube-schedule.js.", entries: [] };
  const data = existsSync(SCHEDULE_PATH) ? JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8")) : fresh;
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  return data;
}
function saveSchedule(data) {
  data.entries.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  writeFileSync(SCHEDULE_PATH + ".tmp", JSON.stringify(data, null, 2) + "\n");
  renameSync(SCHEDULE_PATH + ".tmp", SCHEDULE_PATH);
}

// ---------------------------------------------------------------------------
// Textos do episódio (gerados pela produção em longform/)
// ---------------------------------------------------------------------------

function findEpisode(arg) {
  const dirs = existsSync(EPISODES) ? readdirSync(EPISODES).filter((d) => statSync(join(EPISODES, d)).isDirectory()) : [];
  const n = /^(?:ep)?0*(\d+)$/i.exec(String(arg))?.[1];
  const dir = dirs.find((d) => d === arg) || (n && dirs.find((d) => new RegExp(`^ep0*${n}(-|$)`, "i").test(d)));
  if (!dir) throw new Error(`Episódio "${arg}" não encontrado em longform/episodes (${dirs.join(", ")})`);
  return join(EPISODES, dir);
}

// youtube.txt: blocos TITLE:, DESCRIPTION:, TAGS:
function parseYouTubeTxt(text) {
  const grab = (name, next) => {
    const m = new RegExp(`^${name}:\\s*\\n([\\s\\S]*?)(?=^(?:${next}):|$(?![\\s\\S]))`, "m").exec(text);
    return m ? m[1].trim() : "";
  };
  return {
    title: grab("TITLE", "DESCRIPTION|TAGS"),
    description: grab("DESCRIPTION", "TAGS"),
    tags: grab("TAGS", "\\$NONE").split(",").map((t) => t.trim()).filter(Boolean),
  };
}

// shorts/postagem.txt: blocos "SHORT N — nome" com "Legenda:" + hashtags; créditos no fim
function parsePostagem(text) {
  const shorts = [];
  const re = /^SHORT\s+(\d+)\s*[—-]\s*(.+)\n-+\n([\s\S]*?)(?=^SHORT\s+\d+|^Créditos|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text))) {
    const body = m[3].replace(/^Legenda:\s*\n/m, "").trim();
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const hashtags = lines.filter((l) => /^#\w/.test(l)).join(" ");
    const caption = lines.filter((l) => !/^#\w/.test(l)).join(" ");
    shorts.push({ n: Number(m[1]), name: m[2].trim(), caption, hashtags });
  }
  const credits = /^Créditos[^\n]*\n([\s\S]*)$/m.exec(text)?.[1].trim() || "";
  return { shorts, credits };
}

function shortTitle(caption) {
  const clean = caption.replace(/\s*🇧🇷\s*/g, " ").trim();
  // Junta frases curtas ("December 28, 1992.") até dar um título com sentido
  let first = "";
  for (const s of clean.split(/(?<=[.!?])\s+/)) {
    if (first && (first + " " + s).length > 90) break;
    first = first ? `${first} ${s}` : s;
    if (first.length >= 30) break;
  }
  let t = first.length <= 90 ? first : clean.slice(0, 88).replace(/\s+\S*$/, "") + "…";
  return t.replace(/[.]$/, "");
}

const caseFromDir = (dir) => dir.split(sep).pop().replace(/^ep\d+-/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const rel = (p) => relative(REPO, p).split(sep).join("/");
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const localStamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function plan(epArg, opts) {
  const dir = findEpisode(epArg);
  if (!opts.at) throw new Error('Informe o horário do episódio: --at "AAAA-MM-DD HH:MM"');
  const start = new Date(opts.at.replace(" ", "T"));
  if (isNaN(start)) throw new Error(`Horário inválido: ${opts.at}`);
  const gap = Number(opts.gap || 1);
  const [sh, sm] = (opts["shorts-time"] || `${start.getHours()}:${start.getMinutes()}`).split(":").map(Number);

  const data = loadSchedule();
  const has = (file) => data.entries.some((e) => e.file === file);
  const added = [];
  const caseName = caseFromDir(dir);

  const video = readdirSync(dir).find((f) => /\.mp4$/i.test(f));
  const ytTxt = join(dir, "youtube.txt");
  if (!video || !existsSync(ytTxt)) throw new Error(`Faltam o vídeo .mp4 ou o youtube.txt em ${rel(dir)}`);
  const meta = parseYouTubeTxt(readFileSync(ytTxt, "utf-8"));
  const epFile = rel(join(dir, video));
  let epId = data.entries.find((e) => e.file === epFile)?.id;
  if (!has(epFile)) {
    epId = randomUUID().slice(0, 8);
    const entry = { id: epId, at: localStamp(start), kind: "episodio", title: meta.title, platforms: ["yt_long"], case: caseName, note: null,
      status: "rascunho", file: epFile, thumbnail: existsSync(join(dir, "thumbnail.jpg")) ? rel(join(dir, "thumbnail.jpg")) : null,
      description: meta.description, tags: meta.tags };
    data.entries.push(entry);
    added.push(entry);
  }

  const shortsDir = join(dir, "shorts");
  const post = existsSync(join(shortsDir, "postagem.txt")) ? parsePostagem(readFileSync(join(shortsDir, "postagem.txt"), "utf-8")) : { shorts: [], credits: "" };
  const files = existsSync(shortsDir) ? readdirSync(shortsDir).filter((f) => /\.mp4$/i.test(f)).sort() : [];
  files.forEach((f, i) => {
    const n = Number(/short(\d+)/i.exec(f)?.[1] || i + 1);
    const file = rel(join(shortsDir, f));
    if (has(file)) return;
    const p = post.shorts.find((s) => s.n === n) || { caption: f.replace(/\.mp4$/, ""), hashtags: "" };
    const day = addDays(start, gap * (n || i + 1));
    day.setHours(sh, sm || 0, 0, 0);
    const entry = { id: randomUUID().slice(0, 8), at: localStamp(day), kind: "corte", title: shortTitle(p.caption), platforms: ["yt_shorts", "tiktok", "reels"], case: caseName,
      note: `corte ${n}`, status: "rascunho", file, episodeRef: epId, caption: p.caption, hashtags: p.hashtags, credits: post.credits };
    data.entries.push(entry);
    added.push(entry);
  });

  saveSchedule(data);
  if (!added.length) console.log("Nada novo: esse episódio já está na agenda.");
  for (const e of added) console.log(`+ ${e.id}  ${e.at.replace("T", " ")}  ${e.kind.padEnd(8)} ${e.title}`);
  if (added.length) console.log(`\n${added.length} item(ns) criados como RASCUNHO. Revise na dashboard e aprove para subir.`);
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

async function accessToken() {
  const { BN_YOUTUBE_CLIENT_ID: id, BN_YOUTUBE_CLIENT_SECRET: secret, BN_YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) throw new Error("Falta autorizar o YouTube neste computador: coloque BN_YOUTUBE_CLIENT_ID/SECRET no .env e rode `npm run bn:youtube:auth`.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google recusou o token: ${data.error_description || data.error}`);
  return data.access_token;
}

function buildMetadata(entry, data) {
  let title = entry.title;
  let description = entry.description || "";
  let tags = entry.tags || [];
  if (entry.kind !== "episodio") {
    if (!/#shorts/i.test(title) && title.length <= 92) title += " #Shorts";
    const ep = data.entries.find((e) => e.id === entry.episodeRef);
    const epLink = ep?.yt?.id ? `Full episode: https://youtu.be/${ep.yt.id}` : "";
    description = [entry.caption, epLink, entry.credits, [entry.hashtags, "#Shorts"].filter(Boolean).join(" ")].filter(Boolean).join("\n\n");
    tags = (entry.hashtags || "").split(/\s+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
  }
  return {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags, categoryId: CATEGORY_ID, defaultLanguage: "en", defaultAudioLanguage: "en" },
    status: {
      privacyStatus: "private",
      publishAt: new Date(entry.at).toISOString(),
      selfDeclaredMadeForKids: false,
      // Narração com voz sintética e cenas recriadas de casos reais: o YouTube pede essa marcação
      containsSyntheticMedia: entry.syntheticMedia ?? true,
    },
  };
}

function check(entry, data) {
  const problems = [];
  if (!entry.platforms?.some((p) => p.startsWith("yt_"))) problems.push("não tem YouTube nas redes");
  if (!entry.file) problems.push("sem arquivo de vídeo");
  else if (!existsSync(join(REPO, entry.file))) problems.push(`arquivo não existe: ${entry.file}`);
  const when = new Date(entry.at);
  if (!(when - Date.now() > 15 * 60 * 1000)) problems.push("horário já passou (ou falta menos de 15 min): ajuste na agenda");
  const meta = buildMetadata(entry, data);
  if (!meta.snippet.title) problems.push("sem título");
  if (meta.snippet.tags.join(",").length > 480) problems.push("tags passam do limite de 500 caracteres");
  return { problems, meta };
}

async function uploadVideo(token, filePath, metadata) {
  const size = statSync(filePath).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) throw new Error(`YouTube recusou o envio: ${(await init.text()).slice(0, 400)}`);
  const location = init.headers.get("location");
  const fd = openSync(filePath, "r");
  let offset = 0, retries = 0;
  try {
    while (true) {
      const end = Math.min(offset + CHUNK, size);
      const buf = Buffer.alloc(end - offset);
      readSync(fd, buf, 0, buf.length, offset);
      let res;
      try {
        res = await fetch(location, { method: "PUT", headers: { "Content-Length": String(buf.length), "Content-Range": `bytes ${offset}-${end - 1}/${size}` }, body: buf });
      } catch (e) {
        res = { status: 0, text: async () => e.message };
      }
      if (res.status === 200 || res.status === 201) { process.stdout.write("\n"); return res.json(); }
      if (res.status === 308) {
        const range = res.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : 0;
        retries = 0;
        process.stdout.write(`\r   enviando… ${Math.round((offset / size) * 100)}%   `);
        continue;
      }
      if ((res.status === 0 || res.status >= 500) && retries < 5) {
        retries++;
        await new Promise((r) => setTimeout(r, 2000 * retries));
        // Pergunta ao YouTube quanto já chegou e continua de lá
        const q = await fetch(location, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` } }).catch(() => null);
        if (q?.status === 308) { const r = q.headers.get("range"); offset = r ? Number(r.split("-")[1]) + 1 : 0; }
        else if (q && (q.status === 200 || q.status === 201)) return q.json();
        continue;
      }
      throw new Error(`Falha no envio (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
  } finally {
    closeSync(fd);
  }
}

async function setThumbnail(token, videoId, jpgPath) {
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
    body: readFileSync(jpgPath),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200));
}

async function upload(ids, { dryRun = false } = {}) {
  const data = loadSchedule();
  const pick = ids.length ? ids.map((id) => data.entries.find((e) => e.id === id) || (() => { throw new Error(`Item ${id} não está na agenda`); })()) : [];
  if (!pick.length) throw new Error("Diga quais itens subir: upload <id...> (veja os ids com `list`)");
  // Episódio primeiro, para os cortes já saírem com o link dele
  pick.sort((a, b) => (a.kind === "episodio" ? -1 : 0) - (b.kind === "episodio" ? -1 : 0) || a.at.localeCompare(b.at));
  let token = null;
  let failed = 0;
  for (const entry of pick) {
    const label = `${entry.id} (${entry.at.replace("T", " ")}) ${entry.title}`;
    if (entry.yt?.id) { console.log(`= ${label}: já está no YouTube (${entry.yt.url})`); continue; }
    const { problems, meta } = check(entry, data);
    if (!dryRun && entry.status !== "aprovado") problems.push("ainda não foi aprovado");
    if (problems.length) { console.log(`✗ ${label}\n   ${problems.join("\n   ")}`); failed++; continue; }
    const file = join(REPO, entry.file);
    const mb = (statSync(file).size / 1048576).toFixed(1);
    if (dryRun) {
      console.log(`✓ ${label}\n   arquivo: ${entry.file} (${mb} MB)\n   título: ${meta.snippet.title}\n   publica: ${meta.status.publishAt} (privado até lá)\n   tags: ${meta.snippet.tags.slice(0, 6).join(", ")}${meta.snippet.tags.length > 6 ? "…" : ""}\n   descrição: ${meta.snippet.description.split("\n")[0].slice(0, 100)}…${entry.thumbnail ? `\n   thumbnail: ${entry.thumbnail}` : ""}`);
      continue;
    }
    token = token || (await accessToken());
    console.log(`↑ ${label} — ${mb} MB`);
    const video = await uploadVideo(token, file, meta);
    const isShort = entry.kind !== "episodio";
    entry.yt = { id: video.id, url: isShort ? `https://www.youtube.com/shorts/${video.id}` : `https://www.youtube.com/watch?v=${video.id}`, publishAt: meta.status.publishAt, uploadedAt: new Date().toISOString() };
    if (entry.thumbnail && existsSync(join(REPO, entry.thumbnail))) {
      try { await setThumbnail(token, video.id, join(REPO, entry.thumbnail)); entry.yt.thumbnail = "ok"; }
      catch (e) { entry.yt.thumbnail = "erro"; console.warn(`   ⚠️  thumbnail não foi: ${e.message} (o canal precisa estar verificado por telefone)`); }
    }
    entry.status = "agendado";
    saveSchedule(data); // grava a cada vídeo: se cair no meio, o que subiu fica registrado
    console.log(`✓ agendado: ${entry.yt.url} — publica em ${new Date(entry.at).toLocaleString("pt-BR")}`);
    if (isShort) console.log("   lembrete: no YouTube Studio, ligue este Short ao episódio em \"Vídeo relacionado\" (a API não faz isso)");
  }
  if (dryRun) console.log("\n(simulação: nada foi enviado)");
  if (failed) process.exitCode = 1;
}

function approve(ids) {
  const data = loadSchedule();
  for (const id of ids) {
    const e = data.entries.find((x) => x.id === id);
    if (!e) { console.log(`✗ ${id}: não encontrado`); continue; }
    if (e.yt?.id) { console.log(`= ${id}: já está no YouTube`); continue; }
    e.status = "aprovado";
    console.log(`✓ ${id} aprovado: ${e.title}`);
  }
  saveSchedule(data);
}

function list() {
  const data = loadSchedule();
  if (!data.entries.length) return console.log("Agenda vazia.");
  for (const e of data.entries) {
    const st = e.yt?.id ? `agendado ${e.yt.url}` : e.status || "—";
    console.log(`${e.id}  ${e.at.replace("T", " ")}  ${(e.kind || "").padEnd(8)} ${String(st).padEnd(10)} ${e.title}`);
  }
}

// ---------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
const opts = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) { const k = rest[i].slice(2); opts[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true; }
  else args.push(rest[i]);
}

try {
  if (cmd === "plan") plan(args[0], opts);
  else if (cmd === "approve") approve(args);
  else if (cmd === "upload") await upload(args, { dryRun: !!opts["dry-run"] });
  else if (cmd === "list") list();
  else console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8").split("*/")[0]);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
}

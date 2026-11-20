/**
 * Brazil Noir — autoriza o canal do YouTube neste computador (uma vez só).
 *
 * Abre o navegador na tela de consentimento do Google, recebe a autorização
 * em http://127.0.0.1:8765/callback e grava BN_YOUTUBE_REFRESH_TOKEN no .env.
 * Pede de uma vez os três acessos que a dashboard usa:
 *   youtube.upload           subir e agendar vídeos
 *   youtube.readonly         ler os vídeos agendados no YouTube Studio
 *   yt-analytics.readonly    retenção, horas assistidas, inscritos por vídeo
 *
 * Precisa do cliente OAuth do Google Cloud: o JSON baixado em Credenciais
 * (client_secret_*.json na pasta Downloads, ou --client <arquivo>), ou
 * BN_YOUTUBE_CLIENT_ID e BN_YOUTUBE_CLIENT_SECRET já no .env do codex-mental.
 * Se o Google responder "redirect_uri_mismatch", cadastre
 * http://127.0.0.1:8765/callback como URI de redirecionamento do cliente
 * (ou use um cliente do tipo "App para computador").
 *
 * Uso:  npm run bn:youtube:auth
 */

import "dotenv/config";
import { createServer } from "http";
import { spawn } from "child_process";
import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../../.env");
const PORT = 8765;
const EXPECTED_HANDLE = "@ytbrazilnoir";
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

function updateEnvVar(key, value) {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content) ? content.replace(re, `${key}=${value}`) : content.trimEnd() + (content ? "\n" : "") + `${key}=${value}\n`;
  writeFileSync(ENV_PATH, content);
}

// Cliente OAuth: do JSON baixado do Google Cloud (--client <arquivo>, ou o
// client_secret_*.json mais recente da pasta Downloads) ou do .env.
// O JSON é lido e gravado no .env; o segredo nunca é mostrado na tela.
function clientFromJson() {
  const i = process.argv.indexOf("--client");
  let file = i > 0 ? process.argv[i + 1] : null;
  if (!file) {
    const downloads = join(homedir(), "Downloads");
    const found = existsSync(downloads) ? readdirSync(downloads).filter((f) => /^client_secret.*\.json$/i.test(f)).map((f) => join(downloads, f)) : [];
    file = found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!file) return null;
  }
  if (!existsSync(file)) { console.error(`❌ Arquivo não encontrado: ${file}`); process.exit(1); }
  const json = JSON.parse(readFileSync(file, "utf-8"));
  const c = json.installed || json.web;
  if (!c?.client_id || !c?.client_secret) { console.error(`❌ ${file} não parece um cliente OAuth do Google (faltam client_id/client_secret).`); process.exit(1); }
  if (json.web) console.warn("⚠️  Esse cliente é do tipo \"Aplicativo da Web\". Se o Google reclamar de redirect_uri, crie um do tipo \"App para computador\".");
  updateEnvVar("BN_YOUTUBE_CLIENT_ID", c.client_id);
  updateEnvVar("BN_YOUTUBE_CLIENT_SECRET", c.client_secret);
  console.log(`🔑 Cliente OAuth lido de ${file} e salvo no .env.`);
  return { id: c.client_id, secret: c.client_secret };
}

const fromJson = clientFromJson();
const clientId = fromJson?.id || process.env.BN_YOUTUBE_CLIENT_ID;
const clientSecret = fromJson?.secret || process.env.BN_YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("❌ Não achei o cliente OAuth do Google.");
  console.error("   Baixe o JSON do cliente no Google Cloud (Credenciais → seu cliente → Baixar JSON)");
  console.error("   e deixe na pasta Downloads, ou rode: npm run bn:youtube:auth -- --client \"caminho\\do\\arquivo.json\"");
  process.exit(1);
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPES.join(" "),
  access_type: "offline",
  prompt: "select_account consent",
  include_granted_scopes: "true",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
});

const page = (msg) => `<!doctype html><meta charset="utf-8"><title>Brazil Noir</title><body style="font:16px system-ui;background:#0f0f10;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0"><p>${msg}</p></body>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/callback") { res.writeHead(404); return res.end(); }
  const done = (status, msg) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }); res.end(page(msg)); };
  if (url.searchParams.get("state") !== state) return done(400, "Pedido inválido (state). Rode o comando de novo.");
  if (url.searchParams.get("error")) { done(400, `Autorização recusada: ${url.searchParams.get("error")}`); return finish(1); }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: "authorization_code", code_verifier: verifier }),
    });
    const data = await r.json();
    if (!data.refresh_token) throw new Error(data.error_description || data.error || "o Google não devolveu refresh_token");
    // Só aceita o canal do Brazil Noir: um token de outro canal subiria vídeo no lugar errado.
    const mine = await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${data.access_token}` } })).json();
    const ch = mine.items?.[0]?.snippet;
    if (!ch || (ch.customUrl || "").toLowerCase() !== EXPECTED_HANDLE) {
      const nome = ch ? `${ch.title} (${ch.customUrl || "sem @"})` : "nenhum canal";
      done(400, `Esse login é do canal <b>${nome}</b>, não do Brazil Noir. Nada foi salvo. Rode de novo e, na tela do Google, escolha o canal Brazil Noir.`);
      console.error(`❌ Canal errado: ${nome}. Nada foi salvo. Rode de novo e escolha o canal Brazil Noir.`);
      return finish(1);
    }
    updateEnvVar("BN_YOUTUBE_REFRESH_TOKEN", data.refresh_token);
    const granted = (data.scope || "").split(" ").map((s) => s.split("/").pop());
    done(200, "Pronto! O canal foi autorizado. Pode fechar esta aba.");
    console.log(`✅ Autorizado. Acessos concedidos: ${granted.join(", ")}`);
    const missing = SCOPES.map((s) => s.split("/").pop()).filter((s) => !granted.includes(s));
    if (missing.length) console.warn(`⚠️  Faltou marcar: ${missing.join(", ")} — rode de novo e marque todas as caixas.`);
    console.log(`   Token salvo em ${ENV_PATH} (BN_YOUTUBE_REFRESH_TOKEN).`);
    finish(0);
  } catch (e) {
    done(500, `Não deu certo: ${e.message}`);
    console.error(`❌ ${e.message}`);
    finish(1);
  }
});

function finish(code) { setTimeout(() => { server.close(); process.exit(code); }, 300); }

server.listen(PORT, "127.0.0.1", () => {
  console.log("🔐 Abrindo o navegador para autorizar o canal do Brazil Noir no YouTube...");
  console.log("   Entre na conta do canal e marque todas as permissões.");
  console.log(`   Se o navegador não abrir, copie este endereço:\n   ${authUrl}\n`);
  spawn("cmd", ["/c", "start", "", authUrl.replace(/&/g, "^&")], { stdio: "ignore", detached: true, windowsHide: true }).unref();
});
setTimeout(() => { console.error("⏱️  Tempo esgotado (5 min). Rode de novo."); process.exit(1); }, 5 * 60 * 1000).unref();

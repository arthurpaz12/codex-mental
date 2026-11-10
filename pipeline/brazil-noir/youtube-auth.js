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
 * Precisa, no .env do codex-mental: BN_YOUTUBE_CLIENT_ID e BN_YOUTUBE_CLIENT_SECRET
 * (o mesmo cliente OAuth que o pipeline já usa para publicar).
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
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "../../.env");
const PORT = 8765;
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

const clientId = process.env.BN_YOUTUBE_CLIENT_ID;
const clientSecret = process.env.BN_YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(`❌ Falta BN_YOUTUBE_CLIENT_ID e/ou BN_YOUTUBE_CLIENT_SECRET em ${ENV_PATH}`);
  console.error("   Copie do .env do outro computador (são os mesmos do pipeline) e rode de novo.");
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
  prompt: "consent",
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

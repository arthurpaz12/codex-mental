/**
 * Login da dashboard do Brazil Noir na Vercel (Routing Middleware).
 *
 * Protege tudo em /brazil-noir (página e arquivos de dados). A v1 e as
 * páginas usadas pelo TikTok (privacy, terms, verificação) continuam abertas.
 *
 * Variáveis de ambiente na Vercel (Settings → Environment Variables):
 *   BN_DASH_USER       usuário
 *   BN_DASH_PASSWORD   senha (use uma forte)
 *   BN_DASH_SECRET     opcional: segredo para assinar a sessão (padrão: a senha)
 * Sem usuário e senha configurados, a dashboard fica bloqueada para todos.
 * Trocar a senha (ou o segredo) derruba todas as sessões abertas.
 */

export const config = { matcher: ["/brazil-noir", "/brazil-noir/:path*"] };

const COOKIE = "bn_session";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

// Continua para o arquivo pedido (equivalente ao next() do @vercel/functions)
const next = (headers = {}) => new Response(null, { headers: { "x-middleware-next": "1", ...headers } });

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

// Comparação em tempo constante (via HMAC dos dois lados)
async function same(a, b, secret) {
  const [x, y] = await Promise.all([hmac(secret, "cmp:" + String(a ?? "")), hmac(secret, "cmp:" + String(b ?? ""))]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function makeToken(user, secret) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${await hmac(secret, `${user}|${exp}`)}`;
}

async function validToken(token, user, secret) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return same(sig, await hmac(secret, `${user}|${exp}`), secret);
}

function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.get("cookie") || "");
  return m ? decodeURIComponent(m[1]) : null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(status, body, headers = {}) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Brazil Noir · Entrar</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2318181b'/%3E%3Ccircle cx='16' cy='16' r='7' fill='%23e5484d'/%3E%3C/svg%3E">
<style>
:root{color-scheme:dark;--bg:#0f0f10;--s:#18181b;--b:#27272a;--b2:#34343a;--ink:#f4f4f5;--mu:#8b8b94;--ac:#e5484d;--bad:#ff6369}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f5f5f4;--s:#fff;--b:#e7e7e4;--b2:#d9d9d5;--ink:#18181b;--mu:#74747c;--ac:#d6343a;--bad:#c21d24}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.box{width:100%;max-width:360px;background:var(--s);border:1px solid var(--b);border-radius:14px;padding:28px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:22px}.mark{width:34px;height:34px;border-radius:50%;background:var(--b);display:grid;place-items:center}.mark i{width:13px;height:13px;border-radius:50%;background:var(--ac)}
h1{font-size:16px;margin:0}p{margin:0;color:var(--mu);font-size:13px}
label{display:block;font-size:12px;color:var(--mu);font-weight:500;margin:14px 0 5px}
input{width:100%;background:var(--bg);border:1px solid var(--b2);border-radius:8px;padding:10px 12px;color:var(--ink);font:inherit}
input:focus{outline:2px solid color-mix(in srgb,var(--ac) 45%,transparent);border-color:transparent}
button{width:100%;margin-top:18px;border:0;background:var(--ac);color:#fff;border-radius:9px;padding:10px;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--bad);font-size:13px;margin-top:12px}
</style></head><body><div class="box"><div class="brand"><div class="mark"><i></i></div><div><h1>Brazil Noir</h1><p>Painel do canal</p></div></div>${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...headers } });
}

const loginForm = (nextPath, error) => `
<form method="post" action="/brazil-noir/login">
  <input type="hidden" name="next" value="${esc(nextPath)}">
  <label for="u">Usuário</label><input id="u" name="user" autocomplete="username" required autofocus>
  <label for="p">Senha</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
</form>`;

// Só aceita voltar para dentro da dashboard
const safeNext = (n) => (typeof n === "string" && /^\/brazil-noir(\/[\w\-./]*)?$/.test(n) && !n.includes("..") ? n : "/brazil-noir/");

export default async function middleware(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const user = process.env.BN_DASH_USER;
  const pass = process.env.BN_DASH_PASSWORD;
  const secret = process.env.BN_DASH_SECRET || pass;

  if (!user || !pass) {
    return page(503, `<p>Dashboard bloqueada: falta configurar <b>BN_DASH_USER</b> e <b>BN_DASH_PASSWORD</b> nas variáveis de ambiente do projeto na Vercel.</p>`);
  }

  if (path === "/brazil-noir/logout") {
    return new Response(null, { status: 303, headers: { Location: "/brazil-noir/login", "Set-Cookie": `${COOKIE}=; Path=/brazil-noir; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }

  if (path === "/brazil-noir/login") {
    if (req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const okUser = form ? await same(form.get("user"), user, secret) : false;
      const okPass = form ? await same(form.get("password"), pass, secret) : false; // compara os dois sempre
      const ok = okUser && okPass;
      if (!ok) {
        await new Promise((r) => setTimeout(r, 800)); // freia tentativa e erro
        return page(401, loginForm(safeNext(form?.get("next")), "Usuário ou senha incorretos."));
      }
      const token = await makeToken(user, secret);
      return new Response(null, {
        status: 303,
        headers: { Location: safeNext(form.get("next")), "Set-Cookie": `${COOKIE}=${token}; Path=/brazil-noir; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    if (await validToken(readCookie(req, COOKIE), user, secret)) return Response.redirect(new URL("/brazil-noir/", url), 303);
    return page(200, loginForm(safeNext(url.searchParams.get("next")), null));
  }

  if (await validToken(readCookie(req, COOKIE), user, secret)) return next({ "X-Robots-Tag": "noindex" });

  // Sem sessão: página vai para o login; arquivos de dados recebem 401
  const wantsHtml = (req.headers.get("accept") || "").includes("text/html");
  if (wantsHtml && req.method === "GET") {
    const login = new URL("/brazil-noir/login", url);
    login.searchParams.set("next", path);
    return Response.redirect(login, 303);
  }
  return new Response(JSON.stringify({ error: "Faça login" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/**
 * Servidor estático local SÓ PARA TESTE/PREVIEW do dashboard.
 *
 * Em produção o dashboard é servido pela Vercel direto da pasta dashboard/;
 * este arquivo NÃO é usado lá. Serve para abrir o painel localmente e
 * conferir mudanças no index.html antes do deploy (ex: as abas por canal).
 *
 * Uso:  node dashboard/serve.mjs   →  http://localhost:8099
 *
 * É iniciado automaticamente pelo preview do Claude Code via
 * .claude/launch.json (config "dashboard"). Pode ser apagado sem afetar
 * o pipeline nem o deploy.
 */
import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";

const ROOT = new URL(".", import.meta.url).pathname;
const PORT = 8099;
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".png": "image/png", ".ico": "image/x-icon", ".css": "text/css" };

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  try {
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(PORT, () => console.log(`Dashboard em http://localhost:${PORT}`));

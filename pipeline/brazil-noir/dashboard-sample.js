/**
 * Brazil Noir — gera dados de EXEMPLO para a dashboard v2
 * (dashboard/brazil-noir/data.sample.json).
 *
 * Simula ~8 semanas do formato novo: 1 episódio longo por semana no YouTube
 * + 3 cortes verticais por episódio (TikTok, Shorts e Reels). Os números são
 * inventados, mas seguem o mesmo formato que o coletor real (analytics.js)
 * grava em data.json — servem para ver o desenho completo da página.
 *
 * Uso:  node pipeline/brazil-noir/dashboard-sample.js
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../../dashboard/brazil-noir/data.sample.json");

// PRNG determinístico — o arquivo sai igual a cada execução
let seed = 20261106;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (a, b) => a + rand() * (b - a);
const lognormal = (median, spread) => median * Math.exp((rand() + rand() + rand() - 1.5) * spread);

const END = new Date("2026-11-06T12:00:00Z");
const START = new Date("2026-09-11T12:00:00Z");
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

const EPISODES = [
  { case: "Banco Central heist", title: "They Dug 80 Meters Under Brazil's Central Bank — and Took R$164 Million", hooks: [
    "Eighty meters. That's how far a gang tunneled under downtown Fortaleza.",
    "They posed as a fake-grass company. The real business was underground.",
    "R$164 million vanished in one weekend. Then the money started hunting them.",
  ] },
  { case: "Daniella Perez", title: "Brazil's TV Star Was Murdered by Her On-Screen Lover", hooks: [
    "Millions watched her fall in love with him on TV. Then he killed her.",
    "The murderer showed up at her wake. And hugged her mother.",
    "Her mother rewrote Brazilian law from a typewriter.",
  ] },
  { case: "Suzane von Richthofen", title: "The Rich Girl Who Opened the Door for Her Parents' Killers", hooks: [
    "She left the door unlocked. Her boyfriend brought the iron bars.",
    "After the murder, they went to a motel. Then she threw a birthday party.",
    "Brazil's most hated woman now gets day release for Mother's Day.",
  ] },
  { case: "Pedrinho Matador", title: "Pedrinho Matador: The Serial Killer Who Only Hunted Killers", hooks: [
    "He killed more than 70 people. Most of them were murderers.",
    "In prison, the other inmates were the ones who were afraid.",
    "He became a YouTuber. Then someone came for him.",
  ] },
  { case: "Elize Matsunaga", title: "The Yoki Heir, the Escort, and the Suitcases", hooks: [
    "She was trained as a nurse. That's why the police noticed the cuts.",
    "Three suitcases. One food-empire heir. Zero witnesses.",
    "The elevator camera recorded everything — except what was inside.",
  ] },
  { case: "Eloá Pimentel", title: "100 Hours Live on TV: The Hostage Siege Brazil Couldn't Stop", hooks: [
    "The whole country watched this hostage crisis live. For 100 hours.",
    "A TV host called the kidnapper on air. Mid-siege.",
    "The police sent her best friend back inside.",
  ] },
  { case: "Champinha", title: "The Teen Killer Brazil Couldn't Legally Punish", hooks: [
    "He was 16. Brazilian law said he'd be free at 21.",
    "Twenty years later, he's still locked up — without a sentence.",
    "A camping trip. Two teenagers. Five men in the woods.",
  ] },
  { case: "Isabella Nardoni", title: "Brazil's Worst Lie: The Isabella Nardoni Case", hooks: [
    "A 5-year-old fell from the 6th floor. The net on the window was cut.",
    "Her father's shirt had a print that told the whole story.",
  ] },
];

const PLATFORMS = {
  tiktok: { medianStart: 260, medianEnd: 2600, spread: 1.05, followRate: 0.009, likeRate: 0.07, shareRate: 0.006, commentRate: 0.004 },
  yt_shorts: { medianStart: 180, medianEnd: 1100, spread: 0.9, followRate: 0.006, likeRate: 0.04, shareRate: 0.002, commentRate: 0.003 },
  reels: { medianStart: 90, medianEnd: 650, spread: 0.85, followRate: 0.005, likeRate: 0.05, shareRate: 0.004, commentRate: 0.002 },
};

const videos = [];
let n = 0;
EPISODES.forEach((ep, e) => {
  const epDate = addDays(START, e * 7 + 1);
  if (epDate > END) return;
  const slug = `ep${String(e + 1).padStart(2, "0")}`;
  const progress = e / (EPISODES.length - 1);
  const age = (END - epDate) / 864e5;

  // Episódio longo no YouTube
  const dur = Math.round(between(500, 620));
  const longViews = Math.round(lognormal(60 + progress * 520, 0.5) * Math.min(1, 0.35 + age / 20));
  const pct = between(27, 43);
  videos.push({
    id: `${slug}-long`, platform: "yt_long", episode: slug, case: ep.case, format: "episode",
    title: ep.title, hook: ep.hooks[0], publishedAt: epDate.toISOString(), durationSec: dur,
    url: "https://www.youtube.com/@ytBrazilNoir", thumb: null,
    views: longViews, likes: Math.round(longViews * 0.05), comments: Math.round(longViews * 0.008), shares: Math.round(longViews * 0.004),
    avgWatchSec: Math.round((dur * pct) / 100), avgViewPct: +pct.toFixed(1),
    followersGained: Math.round(longViews * between(0.012, 0.025)), watchHours: +((longViews * dur * pct) / 100 / 3600).toFixed(1),
    source: "sample",
  });

  // 3 cortes, um a cada 2 dias, cada um em TikTok, Shorts e Reels
  ep.hooks.forEach((hook, c) => {
    const cutDate = addDays(epDate, c * 2 + 1);
    if (cutDate > END) return;
    const cutAge = (END - cutDate) / 864e5;
    const cutDur = Math.round(between(62, 100));
    const hookStrength = lognormal(1, 0.35); // o mesmo gancho tende a ir bem ou mal em todas as redes
    n++;
    for (const [platform, p] of Object.entries(PLATFORMS)) {
      let views = lognormal(p.medianStart + progress * (p.medianEnd - p.medianStart), p.spread) * hookStrength;
      if (n === 8 && platform === "tiktok") views = 48200; // um corte viral, como acontece
      views = Math.round(views * Math.min(1, 0.3 + cutAge / 6));
      const pctCut = Math.min(92, between(34, 64) * Math.sqrt(hookStrength));
      videos.push({
        id: `${slug}-c${c + 1}-${platform}`, platform, episode: slug, case: ep.case, format: "cut",
        title: `${ep.case} — corte ${c + 1}`, hook, publishedAt: cutDate.toISOString(), durationSec: cutDur,
        url: platform === "tiktok" ? "https://www.tiktok.com/@brazilnoir" : platform === "yt_shorts" ? "https://www.youtube.com/@ytBrazilNoir/shorts" : null,
        thumb: null, views,
        likes: Math.round(views * p.likeRate * between(0.7, 1.3)),
        comments: Math.round(views * p.commentRate * between(0.6, 1.4)),
        shares: Math.round(views * p.shareRate * between(0.6, 1.5)),
        avgWatchSec: Math.round((cutDur * pctCut) / 100), avgViewPct: +pctCut.toFixed(1),
        followersGained: Math.round(views * p.followRate * between(0.6, 1.4)), watchHours: null,
        source: "sample",
      });
    }
  });
});

// Série diária: as views de cada vídeo entram com decaimento a partir da postagem
const NET = { yt_long: "youtube", yt_shorts: "youtube", tiktok: "tiktok", reels: "instagram" };
const BASE_FOLLOWERS = { youtube: 4, tiktok: 1, instagram: 0 };
const days = [];
for (let d = START; d <= END; d = addDays(d, 1)) days.push(day(d));
const perDay = Object.fromEntries(Object.keys(BASE_FOLLOWERS).map((k) => [k, Object.fromEntries(days.map((d) => [d, { views: 0, followers: 0, watchHours: 0 }]))]));
for (const v of videos) {
  const pub = new Date(v.publishedAt);
  const lifetime = Math.max(1, Math.floor((END - pub) / 864e5) + 1);
  const weights = Array.from({ length: lifetime }, (_, i) => Math.exp(-i / 2.2));
  const total = weights.reduce((a, b) => a + b, 0);
  weights.forEach((w, i) => {
    const bucket = perDay[NET[v.platform]][day(addDays(pub, i))];
    if (!bucket) return;
    bucket.views += (v.views * w) / total;
    bucket.followers += (v.followersGained * w) / total;
    bucket.watchHours += ((v.watchHours || 0) * w) / total;
  });
}
const daily = [];
for (const [platform, byDay] of Object.entries(perDay)) {
  let followers = BASE_FOLLOWERS[platform];
  let totalViews = platform === "youtube" ? 2122 : platform === "tiktok" ? 980 : 0;
  for (const d of days) {
    const b = byDay[d];
    const gained = Math.round(b.followers);
    followers += gained;
    totalViews += Math.round(b.views);
    daily.push({ date: d, platform, followers, totalViews, views: Math.round(b.views), followersGained: gained, ...(platform === "youtube" && { watchHours: +b.watchHours.toFixed(2) }) });
  }
}

const last = (p) => daily.filter((r) => r.platform === p).at(-1);
const sum = (arr, k) => arr.reduce((s, v) => s + (v[k] || 0), 0);
const accounts = {
  youtube: { followers: last("youtube").followers, views: last("youtube").totalViews, videos: videos.filter((v) => NET[v.platform] === "youtube").length + 29, asOf: END.toISOString(),
    longWatchHours12m: +sum(videos.filter((v) => v.platform === "yt_long"), "watchHours").toFixed(1),
    shortsViews90d: sum(videos.filter((v) => v.platform === "yt_shorts"), "views") },
  tiktok: { followers: last("tiktok").followers, views: last("tiktok").totalViews, likes: sum(videos.filter((v) => v.platform === "tiktok"), "likes"), videos: videos.filter((v) => v.platform === "tiktok").length + 6, asOf: END.toISOString() },
  instagram: { followers: last("instagram").followers, views: last("instagram").totalViews, videos: videos.filter((v) => v.platform === "reels").length, asOf: END.toISOString() },
};

// Gastos de exemplo — mesmo formato do spend.json
const tk = (k) => videos.find((v) => v.platform === "tiktok" && v.id.startsWith(k));
const spend = [
  { date: "2026-09-12", category: "ferramenta", item: "ElevenLabs Creator", note: "Voz do narrador", amount: 118.0, platform: null },
  { date: "2026-09-15", category: "ferramenta", item: "API de roteiro (Claude)", note: "Roteiros dos episódios", amount: 22.4, platform: null },
  { date: "2026-10-01", category: "impulsionamento", item: "TikTok Promote", note: "Teste: corte do Pedrinho", amount: 15.0, platform: "tiktok", videoId: tk("ep04-c1")?.id, results: { views: 3100, followers: 24 } },
  { date: "2026-10-12", category: "ferramenta", item: "ElevenLabs Creator", note: "Voz do narrador", amount: 118.0, platform: null },
  { date: "2026-10-15", category: "ferramenta", item: "API de roteiro (Claude)", note: "Roteiros dos episódios", amount: 31.9, platform: null },
  { date: "2026-10-19", category: "impulsionamento", item: "TikTok Promote", note: "Empurrar o corte viral", amount: 30.0, platform: "tiktok", videoId: tk("ep05-c2")?.id, results: { views: 6400, followers: 71 } },
  { date: "2026-10-24", category: "impulsionamento", item: "Instagram — turbinar Reel", note: "Teste no Reels", amount: 20.0, platform: "instagram", results: { views: 2300, followers: 9 } },
  { date: "2026-10-28", category: "outro", item: "Banco de imagens", note: "Fotos de arquivo (licença)", amount: 12.0, platform: null },
  { date: "2026-11-02", category: "impulsionamento", item: "TikTok Promote", note: "Corte do Eloá", amount: 25.0, platform: "tiktok", videoId: tk("ep06-c1")?.id, results: { views: 4200, followers: 33 } },
];

const out = {
  schema: 1,
  mode: "sample",
  generatedAt: END.toISOString(),
  sources: { youtube: "exemplo", tiktok: "exemplo", instagram: "exemplo" },
  channel: {
    name: "Brazil Noir",
    youtube: { handle: "ytBrazilNoir", url: "https://www.youtube.com/@ytBrazilNoir" },
    tiktok: { handle: "brazilnoir", url: "https://www.tiktok.com/@brazilnoir" },
    instagram: { handle: "brazilnoir", url: null },
  },
  accounts,
  daily,
  videos: videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  spend,
};

writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + "\n");
console.log(`✅ Exemplo: ${videos.length} vídeos, ${daily.length} linhas diárias, ${spend.length} gastos → ${OUT_PATH}`);
console.log(accounts);

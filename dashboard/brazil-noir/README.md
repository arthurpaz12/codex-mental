# Brazil Noir — dashboard v2

Página estática em `dashboard/brazil-noir/` (no ar em `/brazil-noir` do mesmo projeto da Vercel da v1). A v1 (`dashboard/index.html`) não foi alterada.

## Arquivos

| Arquivo | Quem escreve | O que é |
|---|---|---|
| `index.html` | — | a página (sem build, sem dependências) |
| `data.json` | `node pipeline/brazil-noir/analytics.js` | números coletados pelas APIs + histórico diário |
| `data.sample.json` | `node pipeline/brazil-noir/dashboard-sample.js` | dados inventados, botão **Exemplo** no topo |
| `manual.json` | você | snapshots de seguidores, vídeos e correções que a API não dá |
| `spend.json` | você, pela página ou à mão | gastos (impulsionamentos e ferramentas) |
| `schedule.json` | você, pela página ou à mão | vídeos programados (YouTube, TikTok, Reels); viram "publicado" sozinhos quando o vídeo sai com o mesmo título |

## Acesso

Na Vercel, `/brazil-noir` só abre com login (`dashboard/middleware.js`). Configure `BN_DASH_USER` e `BN_DASH_PASSWORD` em **Settings → Environment Variables** do projeto e faça um redeploy. Sem essas variáveis a dashboard fica bloqueada para todos. O servidor local (atalho) não pede login, porque só escuta no próprio computador.

A página lê `manual.json` e `spend.json` direto: editou, salvou, recarregou. No ar, precisa de commit + deploy.

## Ver e usar localmente

```bash
npm run bn:dashboard:serve
```

Abra `http://127.0.0.1:8099/brazil-noir/` (o atalho **Brazil Noir - Dashboard** da área de trabalho faz isso sozinho). O servidor local (`pipeline/brazil-noir/dashboard-server.js`):

- serve a pasta `dashboard/`;
- grava os gastos lançados pela página (**Gastos → Novo gasto**, editar e excluir) em `spend.json`;
- repassa as consultas ao YouTube, então inscritos e views aparecem ao vivo também no local;
- roda o coletor quando o `data.json` tem mais de 6 h, formando o histórico diário enquanto estiver ligado.

Ele só escuta em `127.0.0.1` e só aceita escrita vinda da própria página. Na Vercel a página é estática: os gastos aparecem, mas o botão de lançar avisa que é preciso abrir pelo servidor local. Abrir o `index.html` direto do disco não funciona (o navegador bloqueia o `fetch` dos JSON).

## O que está ligado e o que falta

| Fonte | Status | Para ligar |
|---|---|---|
| YouTube público (inscritos, views, likes, comentários, todos os uploads) | **ligado** | `YOUTUBE_API_KEY` no `.env` (a mesma da v1). No ar, a página também atualiza isso ao vivo |
| YouTube Analytics e agendados (retenção, tempo assistido, horas p/ o YPP, inscritos por vídeo, views por dia, vídeos agendados no Studio) | falta | OAuth da conta do Brazil Noir com os escopos `https://www.googleapis.com/auth/yt-analytics.readonly` e `https://www.googleapis.com/auth/youtube.readonly`. O refresh token de upload não tem esse escopo: gere um novo e salve em `BN_YOUTUBE_CLIENT_ID`, `BN_YOUTUBE_CLIENT_SECRET`, `BN_YOUTUBE_REFRESH_TOKEN` |
| TikTok (seguidores, views/likes/comentários/compartilhamentos) | manual | Escopos `user.info.stats` e `video.list` aprovados no app do TikTok + token da conta em `BN_TIKTOK_ACCESS_TOKEN` / `BN_TIKTOK_REFRESH_TOKEN` (`TIKTOK_CLIENT_KEY/SECRET` já existem). Retenção e seguidores por vídeo não saem pela API: copie do TikTok Studio para `manual.json` |
| Instagram Reels | não ligado | Conta profissional ligada a uma página do Facebook + app da Meta com `instagram_basic` e `instagram_manage_insights`. Salve `BN_IG_USER_ID` e `BN_IG_ACCESS_TOKEN` (longa duração) |
| Gastos | pela página | Botão **Novo gasto** (servidor local) ou edição de `spend.json`. O TikTok Promote não tem API pública de relatório |
| Histórico diário | em formação | O servidor local coleta sozinho a cada 6 h enquanto estiver ligado. Para a versão da Vercel, commitar `dashboard/brazil-noir/data.json` de tempos em tempos |

Sem YouTube Analytics, as horas de exibição e as views de Shorts em 90 dias aparecem como **≈ estimado** nas metas de monetização.

## Regras usadas nas metas

- **YouTube Partner Program (anúncios):** 1.000 inscritos + 4.000 h de exibição pública de vídeos longos em 12 meses, **ou** 10 mi de views de Shorts em 90 dias.
- **YPP nível inicial:** 500 inscritos + 3 envios públicos em 90 dias + 3.000 h em 12 meses **ou** 3 mi de views de Shorts em 90 dias.
- **TikTok Creator Rewards:** 10 mil seguidores + 100 mil views em 30 dias; só vídeos com mais de 1 minuto geram receita (conta pessoal, 18+, país elegível).

## Como o YouTube separa vídeo comum de Short

A API não informa a proporção do vídeo. O coletor considera Short o que tem até 3 min **e** `#Shorts` no título, ou estava marcado como `youtube_shorts` na v1, ou foi publicado a partir de 01/08/2026 (formato novo, em que tudo curto é corte vertical). Acima de 3 min é vídeo longo. Para corrigir um caso, use `overrides` no `manual.json` com `"platform": "yt_shorts"` ou `"yt_long"`.

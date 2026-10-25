# GOT Poll

Counts anime votes from Twitch and YouTube chat live, and shows them on an animated viewer page for OBS.

## Run

```bash
pnpm install
pnpm dev          # Vite + Electron, with hot reload
pnpm build        # Windows installer (electron-builder)
```

## Viewer page

`http://localhost:4747` (the app tries 4747–4749 so the OBS URL stays stable). Add it as an OBS browser source at 1920×1080. Add `?transparent=1` to drop the background.

- **Live**: pushed over a WebSocket (`/ws`), so updates are instant. Counts spring-animate, "+N" pops appear on new votes, rank arrows show movement, and covers fly between positions. Rows re-sort at most every 1.2 s so bursts of chat don't make it jitter. The background is a blurred version of the current leader's cover.
- **Final**: when you end the poll the page runs a reveal: "POLL CLOSED" → 3rd → 2nd → drumroll → WINNER with confetti → the rest of the standings. Press **R** on the page to replay it.

## Sharing the viewer page

The **Share** button (title bar) and Settings → **Sharing** list every address the viewer page works at:

- **This PC**: `http://localhost:4747`, for OBS on the same computer.
- **Your network**: e.g. `http://192.168.1.10:4747`, for a second PC or a phone.
- **Public link**: one click on **Go public**.
  - **Cloudflare Quick Tunnel** (default): free, no account, no key. The app downloads the official `cloudflared` once. You get a random `*.trycloudflare.com` address that changes each time, and up to ~200 simultaneous viewers.
  - **ngrok** (optional): paste your own free authtoken (stored only on this computer) for an address that stays the same. On ngrok's free plan, browsers see a one-click notice first and traffic is capped at 1 GB/month.

The public link points at a separate loopback-only server that serves **only** the read-only viewer page, its assets, `/api/counts` and the `/ws` feed. Settings, controls and dev endpoints return 404 from the internet. The live feed is deflate-compressed inside the app (~9 KB → ~2.5 KB per update), because tunnels strip WebSocket compression.

`pnpm test:tunnel <publicPort>` opens a real tunnel to a running app and checks all of that from the outside.

## Chat sources: no keys, no logins

| | what you enter (Settings → Channels) | how |
|---|---|---|
| Twitch | channel name | anonymous read-only IRC |
| YouTube | `@handle`, `UC…` id or a stream link | public live-chat page data (no API key) |
| Rumble | channel link (follows every stream) or a live video link | public chat stream (SSE) |

Staying connected, the same way on all three:

- **Backoff**: retries start at 1s and back off with jitter up to 30s, resetting once a connection has been stable for 30s.
- **Silence watchdog**: a socket that goes quiet (laptop sleep, Wi-Fi switch) is replaced.
- **Instant resume**: on wake from sleep or when the network comes back, everything reconnects immediately.
- **Not live yet**: shows "waiting for the stream" and joins as soon as it starts, following the next stream when one ends.
- **No double counts**: reconnects replay recent chat, so messages are deduped by ID. Anything missed during a short drop is picked up from that replay.

rumble.com pages sit behind Cloudflare's browser check, so the channel → live stream lookup runs in a hidden Chromium window that passes it like any visitor. It blocks images and video and unloads the page right after. If Rumble ever wants an interactive "are you human" click, that window appears so you can do it; the app never tries to get around it.

`pnpm test:live` connects to real Twitch, YouTube and Rumble streams and forces a reconnect halfway through.

## Matching

See [docs/matching.md](docs/matching.md) for the method, sources and benchmark: 93% of votes land on the right show and 0.6% on a wrong one (the old matcher put 35% on a wrong one). Messages it isn't sure about go to **Unmatched chat**. "Count as…" there recounts everyone who typed that phrase and remembers it for future polls.

## Local AI (optional, free, offline)

Settings → **Local AI** sets up smarter matching with open models that run on your own machine. No account, no key, no cloud.

- **Strategies**: Classic (text only), Hybrid (plus an embedding model), and Hybrid + AI judge (plus a local LLM that decides the phrases still in doubt). A strategy whose models aren't downloaded yet quietly falls back to Classic.
- **Models**: multilingual-e5-small (135 MB, handles romaji and 100 languages) or all-MiniLM-L6-v2 (24 MB, English), plus Qwen2.5 1.5B / 3B / 7B (1.1 / 2.1 / 4.7 GB).
- **Hardware**: llama.cpp picks CUDA (NVIDIA), Metal (Apple), Vulkan or CPU automatically. "Auto" picks the biggest model that fits the GPU; an 8 GB card like the RTX 3070 runs 7B fully on the GPU.
- **Downloader**: built in, aria2-style. Eight parallel connections per file, resumable across pause, quit, crash or network loss, sha256-verified against Hugging Face before a file gets its real name.
- **Phrase handling**: the LLM only sees phrases the fast matchers couldn't place, and only in the background, so chat is never delayed. It picks from candidates that already have real text or embedding similarity, so it can't invent a match from one shared word.

`pnpm bench:strategies -- --llm qwen-3b` compares the strategies on the same data as `pnpm bench:matching`.

## Catalogs

Settings → **Catalogs**. All free; only IGDB uses a key, and it's optional.

| | source |
|---|---|
| Anime | AniList (a copy ships with the app) |
| Movies & series | IMDb's free datasets (titles with 2,500+ votes) |
| Games | Wikidata (articles in 4+ Wikipedias), Steam's most-owned games (SteamSpy), box art from Wikipedia, merged into one list. Optional: paste a free Twitch developer app's client id and secret to add IGDB's games, names and covers. The keys stay on this computer. |
| Your own | built in the app; any number |

- **Pooling**: tick several catalogs on the Poll screen or in the tournament setup. Each one gets its own format and release chips, e.g. only movies from IMDb plus only movies from AniList.
- **Editing**: in the Library, fix any title or add missing ones, and split a sequel into its own entry (Boruto out of Naruto). Edits live in `user.db` and survive catalog updates.

## Catalog updates (in-app)

Use Settings → Catalog → **Update from AniList**. It takes about 2–3 minutes and makes about 65 requests under AniList's 30-per-minute limit.

The update can't break anything halfway through:

- It downloads into a separate `catalog-<ts>.partial.db`; the live catalog is never touched.
- The new file must pass `integrity_check` and have at least 85% of the current show count before it's used.
- It's then published by atomic rename plus an atomic pointer (`current.json`) flip.
- A network drop, a cancel, a crash or quitting leaves you on the old catalog. Leftovers are cleaned up on the next start.
- A running poll keeps the catalog it started with; the new one applies to the next poll.
- **Revert** goes back to the previous catalog.
- Ignored shows, taught phrases and settings live in `user.db`, separate from the catalog, so updates never touch them. got-poll's ignores are migrated automatically.

`pnpm update-shows` refreshes the bundled seed (`assets/shows.db`) the same way.

## Dev

```bash
pnpm test             # matcher, poll engine, catalog-update safety
pnpm bench:matching   # matching benchmark (see docs/matching.md)
curl "localhost:4747/api/dev/sim?rate=10"          # fake chat in dev
curl "localhost:4747/api/dev/sim?rate=0&end=1"     # stop it and end the poll
```

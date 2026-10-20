# Topologio

A map-reading game. Each round generates a fresh 6.4 km topographic quadrangle, drops you somewhere on it, and shows a true-scale 3D view from that spot. Click the map where you think you stand, drag toward the direction you face, and score on distance, facing and time.

Built with Next.js (App Router), Three.js, and Drizzle on SQLite/Turso.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Player data goes to `data/topologio.db`, which is created on first request (no migration step).

## Deploy (Vercel + Turso)

1. Create a database: `turso db create topologio`, then get its URL (`turso db show --url topologio`) and a token (`turso db tokens create topologio`).
2. In your Vercel project, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (see `.env.example`).
3. Deploy. Tables are created on the first request.

Without those variables the app uses the local SQLite file, which does not persist on serverless hosts.

## What's in it

| Feature | Where |
|---|---|
| Classic games on four difficulties | `/` |
| Daily challenge: same five Normal maps for everyone, one attempt, streaks | `/daily` |
| Challenge a friend: share `/c/<game>` to replay your exact maps side by side | results page |
| Live race rooms: up to 12 players, same maps, same clock, every guess on the reveal | `/race` |
| Global leaderboards: today's daily, last 7 days, all time, per difficulty | `/leaderboard` |
| Stats: score over time, vs the average player, percentile, accuracy, streaks | `/stats`, `/u/<name>` |
| Map tools: elevation readout, elevation-profile line, zoom | in game |
| Hints that cost points: search area (−25% position), your elevation (−15% position), compass (−50% facing) | in game |

### Difficulties

| | View | Clock | Map | Scoring |
|---|---|---|---|---|
| Easy | Look around 360°, free search circle | none | full | forgiving |
| Normal | One still view | time bonus only | full, elevation readout | standard |
| Hard | Still | 90 s | no elevation readout | stricter |
| Expert | Still, heavier haze | 45 s | no woodland tint or contour labels | strictest |

### Landscapes and water

Every map has a character (mountain, lakeland, coastal or glacial) that decides its features: carved river channels (double-line rivers on the map, flowing water in 3D, white water on steep drops), lakes in natural basins, reservoirs behind embankment dams, coastlines with depth contours, named waterfalls, marsh patches and glaciers (blue contours on the map, ice in 3D).

## How scoring stays honest

The client never posts a score. It posts a guess; the server regenerates the map from its seed, finds the true spot, times the round from its own clock, and scores it. Answers to other players' games stay hidden until you have played those same maps. A determined cheater can still read the camera position out of their own browser, since the client has to render the view. Treat leaderboards as friendly competition.

## Code map

- `src/lib/game/` — the engine, shared by browser and server: terrain and hydrology (`terrain.ts`, `hydrology.ts`, `cover.ts`), viewpoint choice (`viewpoint.ts`), scoring and difficulty rules, the map renderer (`topomap.ts`) and the 3D view (`scene3d.ts`).
- `src/lib/server/` — database (`db.ts`, `schema.ts`), players, games, rooms, leaderboards, stats.
- `src/app/` — pages and API routes. `src/components/` — UI.

## Development helpers

- `npm run check:terrain -- 30` prints feature statistics and generation time for 30 seeds.
- `/dev/preview?seed=123&d=expert` renders any seed's map and view (development server only).
- Changing generation output? Bump `GEN_VERSION` in `src/lib/game/constants.ts` so cached answers are recomputed.

# RoomDraw

Room-wide Skribbl-style draw-and-guess MVP for a short AI/coding-agent
hackathon. The app uses Next.js, Supabase Realtime, and Vercel.

## Features

- Create or join a room with a short code.
- Share a realtime drawing canvas across browser tabs.
- Rotate the drawer and reveal the word only to the drawer.
- Pick from 3 words, use word packs or custom host words, and tune room settings.
- Draw with undo, shapes, fill, opacity, eyedropper, backgrounds, and mobile-friendly controls.
- Submit guesses through the server API with typo tolerance, close hints, rate limiting, and speed scoring.
- Spectate without taking one of the 10 player slots.
- Save round summaries, replay data, and final results in Supabase.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Create a Supabase project and run the schema:

```sql
-- Supabase SQL editor
-- Paste and run supabase/schema.sql
```

3. Add local env vars:

```bash
cp .env.example .env.local
```

Fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Run locally:

```bash
npm run dev
```

Open http://localhost:3000 in two tabs.

## Deploy on Vercel

The production deploy needs a logged-in Vercel CLI and a linked project:

```bash
npx vercel login
npx vercel link
```

Add the same public Supabase env vars in Vercel for Preview and Production:

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add NEXT_PUBLIC_SUPABASE_URL preview
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
```

For stronger server-side game actions, also add the Supabase service role key:

```bash
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY preview
```

Then deploy:

```bash
npx vercel --prod
```

## Supabase Notes

This schema is still hackathon-friendly, but the critical game actions
(`startRound`, `submitGuess`, scoring, kick/restart/next round) are routed
through `src/app/api/game/route.ts`. Add `SUPABASE_SERVICE_ROLE_KEY` on Vercel
before treating those actions as a real server-side boundary.

After running `supabase/schema.sql`, confirm the realtime publication includes
the three tables:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in (
    'rooms',
    'players',
    'guesses',
    'room_settings',
    'round_summaries',
    'final_results',
    'spectators'
  );
```

## Demo

Use the script in `docs/hackathon-demo.md`.

# Hackathon Demo Delivery

## 60-Second Pitch

**Problem:** Party drawing games are fun, but getting everyone into the same room quickly is often the hardest part of a live demo: setup friction, unclear turns, and fragile realtime state can kill the energy.

**Solution:** A room-wide Skribbl-style draw-and-guess app where one player draws, everyone else guesses in their own browser tab, and the room updates live through Supabase Realtime.

**Live demo steps:**
1. Open the deployed Vercel URL in two browser tabs.
2. Create or join the same room in both tabs.
3. Start a round, draw in tab A, and submit guesses from tab B.
4. Show realtime room updates: active drawer, guesses, round progress, and score/feedback.
5. Swap turns or start the next round to prove the shared room state survives more than one action.

**AI/coding-agent angle:** The MVP was assembled with coding agents splitting work across app structure, realtime state, UI, QA, and deployment docs. The value is not just faster code generation; it is parallel execution under tight hackathon constraints while keeping ownership boundaries clear.

**Next improvements:** Add better word packs, player avatars, round timers, moderation for guesses, persistent match history, mobile drawing polish, and a spectator mode for bigger rooms.

## QA Checklist

Focus on demo-breaking issues with two-browser-tab room play:

- Both tabs can load the deployed app without console-breaking errors.
- A room created in tab A can be joined from tab B using the same room code/link.
- Player names or identities do not collide between the two tabs.
- Starting a round in one tab updates the other tab within a second or two.
- Drawing input appears locally and does not freeze the page.
- Guesses submitted from tab B appear in tab A without refresh.
- Correct guesses, if implemented, trigger visible feedback in both tabs.
- Turn/round transitions update both tabs consistently.
- Refreshing one tab can rejoin the room or fail gracefully with a clear path back.
- Empty room, duplicate join, and late join states do not block the happy path.
- The UI fits on the presenter laptop resolution and a narrow/mobile-ish viewport.
- No required demo action depends on local-only data that disappears on deploy.

## Vercel/Supabase Environment Checklist

- Vercel project is linked to the correct Git repository and production branch.
- `NEXT_PUBLIC_SUPABASE_URL` is set in Vercel for Preview and Production.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set in Vercel for Preview and Production.
- Supabase project URL and anon key match the project used during local testing.
- Supabase Realtime is enabled for the tables/channels used by rooms, players, guesses, drawings, and round state.
- Row Level Security policies allow the MVP room flow used in the demo.
- Any required database schema/migrations are applied to the Supabase project.
- Vercel deployment has been redeployed after environment variables changed.
- Production URL has been smoke-tested in two separate browser tabs or profiles.

## Backup Demo Script If Realtime Fails

1. Say: "The realtime provider is not cooperating live, so I will show the intended room flow using manual refreshes/local state."
2. Open two tabs and create/join the same room if possible.
3. In tab A, show the drawing surface and explain the drawer role.
4. In tab B, type a guess and submit it, then refresh tab A if needed to show persisted or expected state.
5. If shared state is unavailable, narrate the event path: create room, subscribe to room channel, broadcast drawing/guess events, update round state.
6. Close with the agent angle: the architecture isolates realtime transport from the core room flow, so the next fix is focused on subscription/env wiring rather than rebuilding the app.

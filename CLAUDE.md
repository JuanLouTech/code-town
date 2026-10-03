# Code Town — working notes for Claude

## Live changes without killing sessions

This island is often being edited from inside itself: the user talks to Claude through a villager
in the running client, and other villagers may be mid-job. Whether a change can go live without
stopping those sessions depends only on which side it touches.

**Client-only changes (`client/`) are safe to apply live.** UI, HUD, dialogs, CSS, the 3D world,
terrain, buildings, island layout, characters, textures, activities, minigames: all of it lives in
the browser. Sessions live in the server process; the browser is just a view. The server rebuilds
the full island state for the client on every connect, and villager names/looks are persisted
server-side per resident id, so a reload brings back the same villagers attached to the same
sessions, with unread replies and pending prompts intact.

To ship a client change while the island is running:

1. `npx vite build` (the production instance from `npm start` serves `dist/` with no watcher).
2. Reload the browser tab. Confirm the "work in progress" warning if a villager is mid-turn.

A reload sends `/api/leave`, but the server only stops sessions if no client reconnects within
`LEAVE_GRACE_MS` (20 s, `server/index.ts`), so a normal reload never stops anything.

**Server or shared changes (`server/`, `shared/`) stop every session.** Restarting the server runs
`shutdown()` → `sessions.stopAll()`, which closes all live sessions, including the one the user is
talking through. They can be resumed by the villager later (transcripts are on disk), but any
in-flight turn is interrupted. Under `npm run dev` this happens automatically on every save, since
the server runs under `tsx watch`.

**Rule for Claude:** when asked to implement something while the app is running, say up front
which bucket it falls into. If it is client-only, offer to apply it live (build + reload, no
sessions lost). If it needs server/shared changes, say that it will stop the running sessions and
let the user choose the moment; where a feature can be split, do the client part live first and
batch the server part for a restart.

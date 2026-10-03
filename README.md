# 🏝️ Code Town

A cozy island where every folder in your workspace is a farm and every Claude Code session is a villager.

Walk up to a villager and press **E** to give them a job. They head to their farm and get to work. Their subagents show up as little gnomes, and when they finish (or need you) they wave at you with a big **!** over their head.

## Running it

```bash
npm install
npm start          # builds the client, serves it on http://127.0.0.1:3666 and opens the browser
```

For development, with hot reload for both server and client:

```bash
npm run dev        # open http://127.0.0.1:3667 (http://127.0.0.1:3666 redirects there in dev)
```

Requirements: Node 22+, and Claude Code installed and logged in (`claude` on your `PATH`). Sessions run through the Claude Agent SDK using your installed `claude` binary, so they get your normal auth, settings, `CLAUDE.md`, hooks and MCP servers.

## How the island maps to your workspace

| On the island | In your workspace |
| --- | --- |
| A property (cottage + farm + sign) | A top-level folder in the workspace (the folder this repo was cloned into) |
| A town (town hall + one house per repo) | A folder containing nested git repos (up to 2 levels deep) |
| Town hall (3 residents) | The parent folder itself, for sessions spanning several repos |
| A villager in a rocking chair | An idle resident: no session yet |
| A villager working the farm | A running Claude Code session |
| A gnome digging | A subagent that has **edited** something, standing on the farm of the repo it touched |
| A gnome with a clipboard | A subagent that has only **read** so far |
| Yellow **!** | The job is done and the reply is unread |
| Orange **!** | Waiting for you: a permission prompt, a question, or a plan to approve |
| Red **!** (looking sad) | Something went wrong |
| Strolling around the yard | Session open, reply already read |
| Back in the rocking chair | Session closed |
| Hiring Office (Tansy 🐑) | Start an extra session ("farmhand") on any farm |
| Construction (Timber 🐻) | Create a new folder / nested git repo; a new building appears. Timber can also rearrange the island |
| A pumpkin in the farm patch 🎃 | A git worktree of that repo: big and orange when it has commits to merge, small and green when empty, with a vine if it was made outside the island, and a ✨ while someone works in it |
| A visitor in a straw hat | A Claude Code session running in a terminal in that folder (its transcript was written in the last few minutes) |

Gnomes follow the files their subagent touches. Paths inside git worktrees (for example `my-workspace/.worktrees/my-repo-feature`) resolve back to the repo they belong to, so the gnome walks to the `my-repo` farm.

Crops grow as tool calls are made on each farm. Chimneys smoke over houses whose villager is busy.

Talk to a pumpkin (**E**) to inspect the worktree (status and commits), open a mailbox in it, start or resume a job there, **harvest** it (a villager merges the branch and removes the worktree, with the usual permission prompts) or **compost** it (`git worktree remove` and delete the branch, after showing what would be lost; refused while someone works in it). Talk to a visitor to bring their conversation onto the island (close it in the terminal first).

## Things to do on the island

While your villagers work:

- 🎣 **Fishing:** face the sea (the pier gets rarer fish) or a pond and press **E**. Wait for the nibbles and press **E** on the big splash. Too early and it swims off.
- 🦋 **Bug catching:** walk up to a butterfly and press **E** to swing the net. Running scares them off.
- 🌳 **Fruit:** shake fruit trees with **E**, then pick up what falls. Each tree gives fruit once a day.
- ⛏️ **Digging:** look for ✖ marks in the grass; they hide fossils and the odd bag of coins. New marks every day.
- 🐚 **Beachcombing:** shells wash up on the beach every day.

Everything goes into your **pockets** (**I**) and the **field guide**, which tracks every species with records. Sell your finds to **Kip** at the plaza fruit stall and spend the coins on hats (the gnome hat is the best one), shirt colours and a **go-kart**.

### The fun fair 🎡

The fair and a kart circuit sit on their own blocks of the island (they move with the rest when Timber rearranges things):

- 🏎️ **Go-kart:** once you've bought one, press **K** anywhere to hop in (the kart comes to you) or **E** next to it. **W/S** drive, **A/D** steer, **Space** hops (hold it to drift), **E** gets out and **K** parks. Talking to someone or using a mailbox climbs out first. The kart stays where you leave it.
- 🏁 **Time trial:** the kart circuit is a long walled track with one way in, through the pit lane. Drive onto the start line and press **E**. Three laps with checkpoints (cutting across doesn't count), and the ten best times are kept. **Esc** gives up.
- 🧩 **Picross:** 15×15 nonograms at the booth: hand-made pictures or random ones (every puzzle has exactly one solution). **WASD** move, **E**/**Space** fill, **X** marks empty; hold the key and move to paint a line. Progress is saved. By default you play against the clock, Picross 2 style: 30 minutes, and every wrong square turns into a × and costs 2, then 4, then 8 minutes, so a late mistake can end the puzzle. Pick **Relaxed** for no clock.

Your coins, pockets, outfit, kart, crops, records and puzzles are saved on the server in `.data/player.json`, so they survive changing the port or opening the island from another browser.

## Talking to villagers

The dialog is a live conversation: the bubble follows the session while you stand there.

- **Idle resident:** start a new job, pick up an old one, or open their mailbox. Old jobs are the real Claude Code conversations for that folder, so anything you did in the terminal shows up too. You can choose model, effort, permission mode and worktree.
- **Working:** the bubble shows their latest narration and a live status line ("🌱 Running `npm test`… · 🧙 2 gnomes"). You can add a message, ask a quick side question with `/btw`, or stop them. Quick answers are typed straight into the bubble, so a quick back-and-forth never leaves the dialog.
- **Finished:** the full reply renders as markdown in the bubble and scrolls (wheel, PageUp/PageDown or Shift+↑/↓). Reply inline, or wrap up the session.
- **Waiting on you:** permission prompts (with the exact command or diff), questions and plans appear in the bubble as they arrive.
- **R** opens the notebook (full transcript, tool steps, typing indicator). **Esc** or *Back to chat* returns to the bubble.
- After you walk away, villagers linger for 3 seconds before heading to the farm, in case you think of something else.

### Slash commands and `/btw`

Type `/` in any reply box to autocomplete the commands Claude Code accepts in SDK mode (`/compact`, `/context`, `/model`, `/effort`, your skills…). The island adds a few of its own:

- `/btw <question>`: answers a side question from the conversation so far without interrupting the job. It runs in a fork of the session that isn't persisted and can't use tools.
- `/stop`: interrupt.
- `/mailbox`: open this folder's terminal.

### Mailboxes (terminals)

Every house has a mailbox. Walk up to it and press **E**, press **T** anywhere inside the property (or on the map, with the house selected), or press **T** while talking to a villager, to open a real terminal (a login shell over a PTY) in that folder. For a villager on a worktree, it opens in the worktree. It's for anything only you can do: `sudo`, interactive prompts, logins. Letters float above everything, so you can keep one open while chatting. You can drag, resize or fold them into the dock, and the mailbox flag goes up while one is open. **Esc** closes a letter when the shell is sitting at its prompt. If a command is still running (say `sudo` waiting for a password), Esc folds the letter into the dock instead of killing it. Full-screen programs like `vim` and `less` still get their Esc.

### Worktrees

- **Repo houses:** the *worktree* toggle starts Claude Code with `--worktree`, so the job runs in `.claude/worktrees/codetown-<name>-<id>` on its own `worktree-…` branch. Claude Code leaves these worktrees on disk when the session ends. Clean them up with `git worktree remove` when you're done.
- **Town halls:** the toggle tells the session to create a worktree per repository before editing anything, so two or three villagers can work in the same town without colliding.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk (Shift to run) |
| E / Enter | Talk, advance dialog, pick a choice |
| Space | Jump (in the kart: hop, hold to drift) |
| Click | Walk somewhere, or walk to a villager and talk |
| R | Read the full reply while in a dialog |
| M | Island map: click, or pick a place with WASD / arrows and press E to travel; T opens that house's mailbox |
| T | The mailbox (terminal) of the property you're standing in |
| Tab / V | Busy villagers list: W/S or ↑/↓ to pick, Enter to travel |
| K | Hop in / park the go-kart |
| Scroll | Zoom |
| R / T | In a dialog: open the notebook / the mailbox terminal |
| Ctrl+W/S (macOS), Alt+W/S (elsewhere) | Scroll the conversation, even while typing a reply |
| I | Pockets and field guide (I again closes them) |
| O / ⚙️ | Options: view distance, horizon curve, shadows, resolution (saved per browser) |
| Esc | Close dialogs; in the notebook, back to the chat; on the open island, the *Leave* dialog (starts on **Stay**) |
| ↑ ↓ ← → / Enter | Lists (old jobs, farm picker) and forms: move, choose, confirm. In forms, Tab or ↑↓ moves between rows and ←→ picks a chip |

## Leaving

**🚪 Leave** asks for confirmation and then stops every running session. Closing the tab also warns you, and the server stops all sessions 20 seconds after the last tab goes away (a reload within that window keeps them). Stopping the server (Ctrl+C) stops all sessions too.

## Configuration

| Env var | Default | |
| --- | --- | --- |
| `CODETOWN_ROOT` | the folder that contains this repo | Folder the island is built from |
| `CODETOWN_PORT` | `3666` | Server port |
| `CODETOWN_CLIENT_PORT` | `3667` | Vite dev client port (`npm run dev`) |
| `CODETOWN_DATA` | `./.data` | Where lot placement, resident names, your progress (`player.json`) and dropped files (`uploads/`) are stored |
| `CLAUDE_BIN` | `which claude` | Claude Code executable |

Lot placement is persistent: new folders get the nearest free spot and existing ones stay put. Ask Timber to rearrange them, or delete `.data/world.json` to re-plan the island.

Rearranging (Timber → *Rearrange the island*) opens the map: pick a property with WASD / arrows, **E** to lift it, move it (it trades places and the island re-packs, always compact), **E** to set it down. Dashed squares are empty lots you can move into; **C** closes all the gaps. On a town, **Space** switches to moving its houses (town hall included) between the town's lots.

Dropping or pasting a file into a reply box puts its path in the message, like the Claude Code terminal. Browsers don't tell pages where a dropped file lives, so the file is copied to `.data/uploads/` (kept for a week) and that copy's path is used.

## Architecture

```
server/     Node: world scanner + layout, session manager (Claude Agent SDK), WebSocket API
shared/     Protocol types shared by both sides
client/     Vite + three.js: the island, villagers and the cozy game-style UI
```

- `server/world.ts` scans the root, detects repos, nested repos and worktrees, and places lots on a grid.
- `server/sessions.ts` runs one `query()` per session with streaming input. It turns SDK events into villager state (status, activity, gnomes) and routes `canUseTool` prompts to the player.
- `server/resolver.ts` maps a path to its building, following worktrees back to their main repo.
- `server/terminals.ts` runs mailbox shells on node-pty.
- `client/src/game/*` covers the curved-world renderer (with wind sway and night glow), house styles, lot frames, landscape and landmarks, ambient life, minigames, characters and the villager "director".
- `client/src/ui/*` covers the dialog bubble, notebook, slash menu, mailbox terminals, pockets, forms, HUD and map.

The server only listens on `127.0.0.1` and rejects WebSocket connections from other origins.

Sessions get a short system-prompt addition telling Claude its final message is shown in a speech bubble, so it opens with a summary.

## License

Copyright 2026 Juan Luis García. Licensed under the [MIT License](LICENSE).

Not affiliated with Anthropic. Claude is a trademark of Anthropic.

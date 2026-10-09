// Wire protocol shared by the island server and the browser client.

import type { TrackDef, TrackRun } from './tracks.ts';

export type Species =
  | 'cat' | 'dog' | 'bear' | 'rabbit' | 'frog' | 'duck' | 'mouse' | 'fox'
  | 'pig' | 'sheep' | 'koala' | 'penguin' | 'human' | 'gnome';

export interface Look {
  species: Species;
  fur: string;      // main body / head colour
  shirt: string;
  accent: string;   // ears inner, snout, trims
  hatColor?: string; // cap / bow colour (defaults to accent)
  hat?: 'straw' | 'cap' | 'cone' | 'hardhat' | 'bow' | 'none';
}

export interface Resident {
  id: string;
  name: string;
  look: Look;
  seat: number;     // which chill spot of the building they own
}

export type BuildingRole = 'single' | 'main' | 'child';

export interface Building {
  id: string;           // path relative to the island root, e.g. "my-workspace/my-repo"
  name: string;
  path: string;         // absolute path
  isRepo: boolean;
  role: BuildingRole;
  propertyId: string;
  slot: number;         // lot index inside the property block (row-major, rows grow towards +z)
  style: number;        // visual variant seed
  residents: Resident[];
}

export interface Property {
  id: string;
  name: string;
  path: string;
  isRepo: boolean;
  kind: 'single' | 'town';
  gx: number;           // top-left lot cell of the block
  gz: number;
  cols: number;
  rows: number;
  buildings: Building[];
}

export interface Block { gx: number; gz: number; cols: number; rows: number }

export interface WorldState {
  root: string;
  version: number;
  plaza: Block;
  /** The fun fair's and the kart circuit's reserved blocks. They take part in the layout like properties. */
  fair?: Block;
  circuit?: Block;
  properties: Property[];
}

/** Keys of the fun fair and the kart circuit in the layout (dot-folders are never scanned, so they can't clash). */
export const FAIR_ID = '.fair';
export const CIRCUIT_ID = '.circuit';
/** Their sizes, in lots. */
export const RESERVED_SIZES: Record<string, { cols: number; rows: number }> = {
  [FAIR_ID]: { cols: 2, rows: 2 },
  [CIRCUIT_ID]: { cols: 8, rows: 5 },
};

export type SessionStatus =
  | 'starting'   // process launching
  | 'working'    // a turn is running
  | 'waiting'    // blocked on a permission prompt / question from the player
  | 'done'       // turn finished, reply not read yet
  | 'idle'       // turn finished and read
  | 'error'      // last turn failed
  | 'closed';    // process ended

export type WorkMode = 'read' | 'write' | 'think';

export interface AgentInfo {
  id: string;            // Agent tool_use id (falls back to task id)
  description: string;
  subagentType?: string;
  status: 'running' | 'done' | 'failed';
  mode: 'read' | 'write';
  buildingId: string;    // where the gnome is actually working
  lastTool?: string;
  background?: boolean;
  toolCount: number;
  startedAt: number;
  endedAt?: number;
}

export interface QuestionOption { label: string; description?: string }
export interface PendingQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface PendingRequest {
  id: string;
  kind: 'permission' | 'question' | 'plan';
  toolName: string;
  title: string;         // one-line human description
  detail?: string;       // markdown: command, diff preview, plan...
  questions?: PendingQuestion[];
  canAlwaysAllow: boolean;
  fromAgent?: string;    // description of the subagent asking, if any
}

export interface Mercenary { name: string; look: Look }

export interface SessionSummary {
  id: string;
  claudeSessionId?: string;
  buildingId: string;
  characterId: string;
  mercenary?: Mercenary;
  title: string;
  status: SessionStatus;
  unread: boolean;
  cwd: string;
  worktree?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  startedAt: number;
  updatedAt: number;
  activity?: { tool: string; label: string; mode: WorkMode };
  lastText?: string;
  pending?: PendingRequest;
  pendingCount: number;
  agents: AgentInfo[];
  costUsd: number;
  turns: number;
  toolCount: number;
  error?: string;
  aside?: { question: string; answer?: string; ts: number }; // latest /btw side question
}

export interface CommandInfo {
  name: string;
  description?: string;
  hint?: string;
}

export type EntryKind = 'user' | 'assistant' | 'tool' | 'result' | 'system' | 'error' | 'aside';

export interface TranscriptEntry {
  id: string;
  ts: number;
  kind: EntryKind;
  text: string;          // markdown for user/assistant, one-line label for tools
  tool?: string;
  detail?: string;
  agentId?: string;      // produced inside a subagent (gnome)
  isError?: boolean;
}

export interface HistoryItem {
  sessionId: string;
  title: string;
  firstPrompt?: string;
  lastModified: number;
  gitBranch?: string;
  cwd?: string;
  liveSessionId?: string;  // already running on the island
}

/** A git worktree of one of the island's repos (a pumpkin in its farm patch). */
export interface WorktreeInfo {
  path: string;
  buildingId: string;
  branch?: string;       // undefined when detached
  base?: string;         // what ahead/behind compare against, e.g. origin/main
  ahead: number;         // commits not on the base branch
  behind: number;
  dirty: number;         // uncommitted files
  mine: boolean;         // created by the island (a `codetown-…` worktree)
  lastCommit?: string;
  lastCommitAt?: number;
}

/** A Claude Code session running outside the island (in a terminal), seen through its transcript. */
export interface VisitorInfo {
  sessionId: string;
  buildingId: string;
  cwd: string;
  at: number;            // last transcript write (ms)
  title?: string;
}

export interface WorktreeDetail {
  path: string;
  status: string[];      // `git status --short`
  ignored: string[];     // ignored files and folders (`git worktree remove` deletes them too)
  log: string[];         // `git log base..HEAD --oneline`
  error?: string;
}

export interface StartOptions {
  model?: string;
  effort?: string;
  permissionMode?: string;
  worktree?: boolean;
}

export type ClientMsg =
  | { t: 'start'; reqId: string; buildingId: string; characterId?: string; hire?: boolean; prompt: string; opts: StartOptions; resume?: string; resumeCwd?: string; cwd?: string }
  | { t: 'send'; id: string; text: string }
  | { t: 'interrupt'; id: string }
  | { t: 'close'; id: string }
  | { t: 'read'; id: string }
  | { t: 'respond'; id: string; requestId: string; decision: 'allow' | 'always' | 'deny'; message?: string; answers?: Record<string, string> }
  | { t: 'setMode'; id: string; mode: string }
  | { t: 'transcript'; id: string }
  | { t: 'history'; buildingId: string; cwd?: string }
  | { t: 'historyLoad'; buildingId: string; sessionId: string; cwd?: string }
  | { t: 'worktree.inspect'; path: string }
  | { t: 'worktree.remove'; path: string; force: boolean }
  | { t: 'build'; parentId: string | null; name: string; git: boolean }
  | { t: 'exit' }
  | { t: 'rescan' }
  | { t: 'arrange'; blocks?: Record<string, { gx: number; gz: number }>; slots?: Record<string, Record<string, number>> }
  | { t: 'save'; key: string; value: unknown }
  | { t: 'track.save'; reqId: string; track: Omit<TrackDef, 'id' | 'created' | 'times'> }
  | { t: 'track.delete'; id: string }
  | { t: 'track.time'; id: string; run: TrackRun }
  | { t: 'term.open'; termId: string; buildingId: string; cwd?: string; cols: number; rows: number }
  | { t: 'term.input'; termId: string; data: string }
  | { t: 'term.resize'; termId: string; cols: number; rows: number }
  | { t: 'term.close'; termId: string }
  | { t: 'term.escape'; termId: string };

export type ServerMsg =
  | { t: 'hello'; world: WorldState; sessions: SessionSummary[]; claudeVersion?: string; commands: Record<string, CommandInfo[]>; player?: Record<string, unknown>; tracks?: TrackDef[]; worktrees?: WorktreeInfo[]; visitors?: VisitorInfo[] }
  | { t: 'commands'; id: string; commands: CommandInfo[] }
  | { t: 'term.data'; termId: string; data: string }
  | { t: 'term.exit'; termId: string; code: number; error?: string; closed?: boolean }
  | { t: 'term.busy'; termId: string; process: string }
  | { t: 'world'; world: WorldState }
  | { t: 'session'; session: SessionSummary }
  | { t: 'sessionRemoved'; id: string }
  | { t: 'entries'; id: string; entries: TranscriptEntry[]; reset?: boolean }
  | { t: 'history'; buildingId: string; cwd?: string; items: HistoryItem[] }
  | { t: 'worktrees'; worktrees: WorktreeInfo[]; visitors: VisitorInfo[] }
  | { t: 'player'; key: string; value: unknown }
  | { t: 'tracks'; tracks: TrackDef[] }
  | { t: 'track.saved'; reqId: string; id?: string; error?: string }
  | { t: 'worktree.detail'; detail: WorktreeDetail }
  | { t: 'worktree.removed'; path: string; error?: string }
  | { t: 'historyTranscript'; sessionId: string; entries: TranscriptEntry[] }
  | { t: 'started'; reqId: string; id?: string; error?: string; session?: SessionSummary }
  | { t: 'built'; buildingId?: string; error?: string }
  | { t: 'toast'; level: 'info' | 'error'; text: string }
  | { t: 'bye'; stopped: number };

export const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export const EFFORT_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
];

export const PERMISSION_CHOICES: { value: string; label: string; hint: string }[] = [
  { value: '', label: 'My settings', hint: 'Use the default mode from your Claude Code settings' },
  { value: 'default', label: 'Ask me', hint: 'Ask before edits and commands' },
  { value: 'acceptEdits', label: 'Auto-edit', hint: 'Accept file edits, ask for commands' },
  { value: 'auto', label: 'Auto', hint: 'Let the auto-mode classifier decide' },
  { value: 'plan', label: 'Plan first', hint: 'Read-only until you approve a plan' },
  { value: 'bypassPermissions', label: 'No limits', hint: 'Skip every permission check (careful!)' },
];

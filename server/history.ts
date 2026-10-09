import { randomUUID } from 'node:crypto';
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { HistoryItem, TranscriptEntry } from '../shared/protocol.ts';
import { describeTool } from './tools.ts';

const MAX_ENTRIES = 600;

export async function listHistory(dir: string, limit = 40): Promise<HistoryItem[]> {
  const list = await listSessions({ dir, limit, includeProgrammatic: true });
  return list
    .filter((s) => s.firstPrompt || s.summary || s.customTitle)
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || 'Untitled conversation',
      firstPrompt: s.firstPrompt,
      lastModified: s.lastModified,
      gitBranch: s.gitBranch,
      cwd: s.cwd,
    }));
}

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown> };

function userText(content: unknown): string | null {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as Block[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
      : '';
  if (!text.trim()) return null;
  if (text.includes('<bash-input>')) {
    // `!` commands (bash mode): show the command, not its output.
    const shown = text
      .replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, (_, c: string) => '`! ' + c.trim() + '`')
      .replace(/<bash-(stdout|stderr)>[\s\S]*?<\/bash-\1>/g, '')
      .trim();
    return shown || null;
  }
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) return `\`${cmd[1].trim()}\``;
  if (/^\s*<(local-command|system-reminder|command-|task-notification)/.test(text) || text.startsWith('Caveat:')) return null;
  return text;
}

export async function loadTranscript(sessionId: string, dir: string, cwd = dir): Promise<TranscriptEntry[]> {
  const msgs = await getSessionMessages(sessionId, { dir });
  const out: TranscriptEntry[] = [];
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const content = (m.message as { content?: unknown } | undefined)?.content;
    if (m.type === 'user') {
      const text = userText(content);
      if (text) out.push({ id: randomUUID(), ts: 0, kind: 'user', text });
    } else if (m.type === 'assistant' && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text?.trim()) {
          out.push({ id: randomUUID(), ts: 0, kind: 'assistant', text: b.text });
        } else if (b.type === 'tool_use' && b.name) {
          out.push({ id: randomUUID(), ts: 0, kind: 'tool', tool: b.name, text: describeTool(b.name, b.input ?? {}, cwd) });
        }
      }
    }
  }
  return out.slice(-MAX_ENTRIES);
}

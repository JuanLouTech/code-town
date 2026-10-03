import path from 'node:path';
import type { WorkMode } from '../shared/protocol.ts';

type Input = Record<string, unknown>;

const READ_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead', 'ToolSearch', 'TodoWrite',
  'ListMcpResourcesTool', 'ReadMcpResourceTool', 'TaskOutput', 'BashOutput', 'Skill',
]);
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const READONLY_COMMAND = /^\s*(cd\s+\S+\s*&&\s*)?(ls|cat|head|tail|wc|grep|rg|find|fd|tree|pwd|echo|which|file|stat|du|df|jq|less|sed\s+-n|git\s+(status|log|diff|show|branch|blame|remote|rev-parse|ls-files|grep)|npm\s+(ls|view)|node\s+--version)\b/;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function isAgentTool(name: string) {
  return name === 'Agent' || name === 'Task';
}

export function toolMode(name: string, input: Input): WorkMode {
  if (READ_TOOLS.has(name) || name.startsWith('mcp__')) return 'read';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (name === 'Bash') return READONLY_COMMAND.test(str(input.command)) ? 'read' : 'write';
  if (isAgentTool(name) || name === 'AskUserQuestion' || name === 'ExitPlanMode') return 'think';
  return 'write';
}

function short(p: string, cwd: string): string {
  if (!p) return '';
  const rel = path.isAbsolute(p) ? path.relative(cwd, p) : p;
  const shown = rel.startsWith('..') ? p : rel || '.';
  return shown.length > 60 ? '…' + shown.slice(-58) : shown;
}

function clip(s: string, n = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

export function describeTool(name: string, input: Input, cwd: string): string {
  switch (name) {
    case 'Read': return `Reading ${short(str(input.file_path), cwd)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${short(str(input.file_path), cwd)}`;
    case 'Write': return `Writing ${short(str(input.file_path), cwd)}`;
    case 'NotebookEdit': return `Editing notebook ${short(str(input.notebook_path), cwd)}`;
    case 'Bash': return `Running \`${clip(str(input.command), 70)}\``;
    case 'Grep': return `Searching for “${clip(str(input.pattern), 40)}”`;
    case 'Glob': return `Looking for ${clip(str(input.pattern), 50)}`;
    case 'WebFetch': return `Fetching ${clip(str(input.url), 60)}`;
    case 'WebSearch': return `Searching the web: ${clip(str(input.query), 50)}`;
    case 'Agent':
    case 'Task': return `Sending a gnome: ${clip(str(input.description), 60)}`;
    case 'TodoWrite': return 'Updating the to-do list';
    case 'AskUserQuestion': return 'Asking you a question';
    case 'ExitPlanMode': return 'Presenting a plan';
    case 'Skill': return `Using skill ${str(input.skill) || str(input.name)}`;
    default:
      if (name.startsWith('mcp__')) return `Using ${name.split('__').slice(1).join(' › ')}`;
      return `Using ${name}`;
  }
}

/** A markdown preview of what a tool is about to do (for permission prompts). */
export function describeInput(name: string, input: Input): string {
  switch (name) {
    case 'Bash':
      return '```bash\n' + str(input.command) + '\n```' + (input.description ? `\n${str(input.description)}` : '');
    case 'Edit':
      return `**${str(input.file_path)}**\n\n\`\`\`diff\n${diffLines(str(input.old_string), str(input.new_string))}\n\`\`\``;
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Input[]) : [];
      return `**${str(input.file_path)}** (${edits.length} edits)\n\n\`\`\`diff\n` +
        edits.slice(0, 4).map((e) => diffLines(str(e.old_string), str(e.new_string))).join('\n…\n') + '\n```';
    }
    case 'Write': {
      const content = str(input.content);
      return `**${str(input.file_path)}**\n\n\`\`\`\n${content.slice(0, 1500)}${content.length > 1500 ? '\n…' : ''}\n\`\`\``;
    }
    case 'WebFetch': return `${str(input.url)}\n\n${str(input.prompt)}`;
    default: {
      const json = JSON.stringify(input, null, 2);
      return '```json\n' + (json.length > 1500 ? json.slice(0, 1500) + '\n…' : json) + '\n```';
    }
  }
}

function diffLines(a: string, b: string): string {
  const cap = (s: string) => s.split('\n').slice(0, 25);
  return [...cap(a).map((l) => '- ' + l), ...cap(b).map((l) => '+ ' + l)].join('\n');
}

/** The filesystem location a tool call is touching, if we can tell. */
export function toolPath(name: string, input: Input, cwd: string): string | undefined {
  const abs = (p: string) => (p ? path.resolve(cwd, p.replace(/^~(?=\/)/, process.env.HOME ?? '~')) : undefined);
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write': return abs(str(input.file_path));
    case 'NotebookEdit': return abs(str(input.notebook_path));
    case 'Grep':
    case 'Glob': return abs(str(input.path)) ?? cwd;
    case 'Bash': return commandPath(str(input.command), cwd);
    default: return undefined;
  }
}

function commandPath(cmd: string, cwd: string): string | undefined {
  const cd = cmd.match(/(?:^|&&|;|\()\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/);
  if (cd) return path.resolve(cwd, cd[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
  const gitC = cmd.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
  if (gitC) return path.resolve(cwd, gitC[1].replace(/^["']|["']$/g, ''));
  const absPath = cmd.match(/(?:^|[\s'"=(:])(\/(?:Users|home|private|tmp|var|opt)[^\s'"`;|&<>()]*)/);
  if (absPath) return absPath[1];
  return undefined;
}

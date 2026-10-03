/**
 * Dropping (or pasting) files into a chat box puts their absolute paths in the text, like the
 * Claude Code terminal does. Browsers never reveal where a dropped file lives, so unless the
 * source hands over file:// URLs, the file is uploaded to the server and the copy's path is used.
 */

function quote(p: string) {
  return /\s/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
}

async function upload(file: File): Promise<string> {
  const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name || 'pasted-file')}`, { method: 'POST', body: file });
  const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !body.path) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.path;
}

function fileUrls(dt: DataTransfer): string[] {
  return dt.getData('text/uri-list').split(/\r?\n/)
    .filter((l) => l.startsWith('file://'))
    .map((l) => decodeURIComponent(new URL(l).pathname));
}

function carriesFiles(dt: DataTransfer | null) {
  return Boolean(dt && (dt.types.includes('Files') || dt.types.includes('text/uri-list')));
}

function insertAtCursor(ta: HTMLTextAreaElement, text: string) {
  const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start), after = ta.value.slice(end);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^\s/.test(after) ? ' ' : '';
  ta.value = before + pre + text + post + after;
  const caret = (before + pre + text).length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input'));
}

async function insertFiles(ta: HTMLTextAreaElement, files: File[], urls: string[], onError: (msg: string) => void) {
  let paths = urls;
  if (!paths.length && files.length) {
    ta.classList.add('uploading');
    try {
      paths = await Promise.all(files.map(upload));
    } catch (err) {
      onError(`📎 ${(err as Error).message}`);
      return;
    } finally {
      ta.classList.remove('uploading');
    }
  }
  if (paths.length) insertAtCursor(ta, paths.map(quote).join(' '));
}

/** Makes `zone` accept dropped files, inserting their paths into `textarea()` (when there is one). */
export function fileDrop(zone: HTMLElement, textarea: () => HTMLTextAreaElement | null | undefined, onError: (msg: string) => void) {
  zone.addEventListener('dragover', (e) => {
    if (!carriesFiles(e.dataTransfer) || !textarea()) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    zone.classList.add('drop-over');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget as Node | null)) zone.classList.remove('drop-over');
  });
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('drop-over');
    const ta = textarea();
    const dt = e.dataTransfer;
    if (!ta || !dt) return;
    const files = [...dt.files], urls = fileUrls(dt);
    // A plain link or some text: let the browser drop it as usual.
    if (!files.length && !urls.length) return;
    e.preventDefault();
    e.stopPropagation();
    void insertFiles(ta, files, urls, onError);
  });
}

/** Pasting a file or screenshot (Cmd+V) into `ta` inserts the uploaded copy's path. */
export function filePaste(ta: HTMLTextAreaElement, onError: (msg: string) => void) {
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void insertFiles(ta, files, [], onError);
  });
}

import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}

export function mdElement(src: string, tag = 'div'): HTMLElement {
  const el = document.createElement(tag);
  el.className = 'md';
  el.innerHTML = renderMarkdown(src);
  for (const a of el.querySelectorAll('a')) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return el;
}

/** Plain-ish text for the speech bubble: keeps **bold** and `code`, drops the rest of the markup. */
export function bubbleText(src: string, max = 320): { html: string; truncated: boolean } {
  let text = src
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const truncated = text.length > max;
  if (truncated) {
    const cut = text.lastIndexOf(' ', max);
    text = text.slice(0, cut > max * 0.6 ? cut : max) + '…';
  }
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = esc
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  return { html, truncated };
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

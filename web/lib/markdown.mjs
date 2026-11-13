// A deliberately small Markdown reader for briefs: headings, bullet lists, paragraphs, **bold**, `code` and [links](https://...).
// It returns plain data (blocks of text spans), never HTML. React renders every span as text, so nothing in a brief, including text
// quoted from a web page, can inject markup or script. Only http and https links become links; anything else stays text.
const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;

export function parseInline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'bold', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'code', v: m[2] });
    else if (SAFE_URL.test(m[4])) out.push({ t: 'link', v: m[3], href: m[4] });
    else out.push({ t: 'text', v: m[0] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export function parseMarkdown(src) {
  const blocks = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { blocks.push({ t: 'p', spans: parseInline(para.join(' ')) }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ t: 'ul', items: list.map(parseInline) }); list = null; } };
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) { flushPara(); flushList(); blocks.push({ t: `h${Math.min(h[1].length + 1, 4)}`, spans: parseInline(h[2]) }); continue; }
    if (li) { flushPara(); (list ??= []).push(li[1]); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks;
}

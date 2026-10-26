/**
 * Card content: a small, safe subset of HTML.
 *
 * Cards are HTML so that decks imported from Anki keep their formatting -
 * bold, lists, tables, line breaks - and so images can sit inline the way
 * they do in Anki's editor. That also makes this file security-critical: an
 * imported deck is someone else's HTML, and Anki fields can carry script.
 *
 * So nothing is filtered in place. The input is tokenised and the output is
 * rebuilt from scratch out of an allow-list of tags and a handful of
 * validated attributes, with every run of text re-escaped. Malformed input
 * can lose formatting; it cannot inject anything. Images are only kept when
 * they point into the app's own media store (`media:<id>`), so a card can
 * never make the browser fetch a remote URL.
 *
 * No DOM needed, so it runs - and is tested - outside a browser.
 */

const ALLOWED = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'br', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'pre', 'code',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'img',
]);

const VOID = new Set(['br', 'hr', 'img']);

/** Removed together with everything inside them, not just unwrapped. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'noscript', 'head',
  'title', 'textarea', 'select', 'button', 'form', 'canvas', 'audio', 'video', 'frameset', 'frame',
]);

const MEDIA_SRC = /^media:[a-z0-9][a-z0-9._-]{0,120}$/i;

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×',
  divide: '÷', deg: '°', plusmn: '±', le: '≤', ge: '≥', ne: '≠', rarr: '→',
  larr: '←', radic: '√', infin: '∞', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** Index of the `>` closing a tag that starts at `start`, honouring quoted attribute values. */
function tagEnd(input: string, start: number): number {
  let quote = '';
  for (let i = start + 1; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return input.length - 1;
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<\/?[a-zA-Z][a-zA-Z0-9]*/, '').replace(/\/?>$/, '');
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function keptAttributes(name: string, attrs: Record<string, string>): string {
  if (name === 'img') {
    const src = attrs.src?.trim() ?? '';
    if (!MEDIA_SRC.test(src)) return '';
    return ` src="${escapeAttr(src)}"${attrs.alt ? ` alt="${escapeAttr(attrs.alt.slice(0, 200))}"` : ''}`;
  }
  if (name === 'td' || name === 'th') {
    let out = '';
    for (const key of ['colspan', 'rowspan']) {
      if (/^\d{1,2}$/.test(attrs[key] ?? '')) out += ` ${key}="${attrs[key]}"`;
    }
    return out;
  }
  return '';
}

export function sanitize(input: string): string {
  let out = '';
  const open: string[] = [];
  let i = 0;

  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(decodeEntities(input.slice(i)));
      break;
    }
    out += escapeText(decodeEntities(input.slice(i, lt)));

    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input[lt + 1] === '!' || input[lt + 1] === '?') {
      i = tagEnd(input, lt) + 1;
      continue;
    }

    const m = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(input.slice(lt, lt + 40));
    if (!m) {
      // A bare "<" in text, such as "a < b".
      out += '&lt;';
      i = lt + 1;
      continue;
    }

    const closing = input[lt + 1] === '/';
    const name = m[1].toLowerCase();
    const end = tagEnd(input, lt);
    const raw = input.slice(lt, end + 1);
    i = end + 1;

    if (!closing && DROP_WITH_CONTENT.has(name)) {
      const close = input.toLowerCase().indexOf(`</${name}`, i);
      i = close === -1 ? input.length : tagEnd(input, close) + 1;
      continue;
    }
    if (!ALLOWED.has(name)) continue;

    if (closing) {
      if (VOID.has(name)) continue;
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }

    const attrs = keptAttributes(name, attributes(raw));
    if (name === 'img' && !attrs) continue;
    out += `<${name}${attrs}>`;
    if (!VOID.has(name)) open.push(name);
  }

  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading content                                                     */
/* ------------------------------------------------------------------ */

/** Media ids referenced by a side, in order. */
export function mediaRefs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]*\ssrc="media:([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/** Plain text for search, previews and sort order. Images read as "[image]". */
export function toPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<img[^>]*>/gi, ' [image] ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBlank(html: string): boolean {
  return toPlainText(html).length === 0;
}

/** Plain text typed into a field, made safe to store as card HTML. */
export function textToHtml(text: string): string {
  return escapeText(text).replace(/\r?\n/g, '<br>');
}

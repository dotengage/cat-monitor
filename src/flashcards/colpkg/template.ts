/**
 * Anki's card templates, rendered.
 *
 * An Anki note is a set of fields; its note type's templates decide what each
 * card shows. Rendering them on import turns a Basic, reversed, type-in or
 * cloze note into the plain front and back this app stores.
 *
 * Supported: `{{Field}}`, `{{FrontSide}}`, `{{#Field}}...{{/Field}}`,
 * `{{^Field}}...{{/Field}}`, chained filters (`text:`, `hint:`, `type:`,
 * `cloze:`, `furigana:` and friends), and `{{cN::answer::hint}}` cloze
 * deletions. Anything the app cannot reproduce - audio, TTS, add-on filters -
 * is dropped rather than shown as raw syntax.
 */

export type Side = 'question' | 'answer';

/** Stands in for {{FrontSide}} until the answer side is split from it. */
export const FRONT_SIDE_MARKER = '\u0000FRONTSIDE\u0000';

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '');

/** Renders `{{cN::...}}` deletions for card N (1-based) on one side. */
export function renderCloze(text: string, n: number, side: Side): string {
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, num: string, answer: string, hint?: string) => {
    if (Number(num) !== n) return answer;
    if (side === 'answer') return `<b>${answer}</b>`;
    return hint ? `<b>[${hint}]</b>` : '<b>[...]</b>';
  });
}

/** Cloze numbers used in a field, e.g. c1 and c3 give [1, 3]. */
export function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

function applyFilters(filters: string[], value: string, ord: number, side: Side): string {
  let out = value;
  // Anki applies filters right to left, nearest the field first.
  for (const filter of [...filters].reverse()) {
    switch (filter) {
      case 'cloze':
        out = renderCloze(out, ord + 1, side);
        break;
      case 'text':
        out = stripHtml(out);
        break;
      case 'type':
        // A type-in box on the question; the correct answer on the answer.
        out = side === 'answer' ? out : '';
        break;
      case 'hint':
      case 'furigana':
      case 'kana':
      case 'kanji':
        break;
      default:
        // tts, tts-voices and add-on filters have nothing to show here.
        if (filter.startsWith('tts')) out = '';
        break;
    }
  }
  return out;
}

export function renderTemplate(
  template: string,
  fields: Record<string, string>,
  ord: number,
  side: Side,
  frontSide = FRONT_SIDE_MARKER,
): string {
  const has = (name: string) => stripHtml(fields[name] ?? '').trim().length > 0;

  // Sections first, innermost outward, so nested sections resolve correctly.
  let out = template;
  for (let guard = 0; guard < 20; guard += 1) {
    const next = out.replace(
      /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g,
      (_, kind: string, name: string, body: string) => {
        const present = name.includes(':') ? true : has(name);
        return (kind === '#') === present ? body : '';
      },
    );
    if (next === out) break;
    out = next;
  }

  return out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
    if (expr === 'FrontSide') return frontSide;
    const parts = expr.split(':');
    const name = parts.pop() as string;
    if (!(name in fields) && parts.length === 0) return '';
    return applyFilters(parts, fields[name] ?? '', ord, side);
  });
}

/**
 * Splits a rendered answer into the part after the question. Anki marks it
 * with `<hr id=answer>`; templates without one just lose their FrontSide.
 */
export function answerOnly(renderedAnswer: string): string {
  const parts = renderedAnswer.split(/<hr\s+id\s*=\s*["']?answer["']?\s*\/?>/i);
  const tail = parts.length > 1 ? parts.slice(1).join('') : parts[0];
  return tail.split(FRONT_SIDE_MARKER).join('').trim();
}

/** Strips things Anki shows that a browser card cannot: sound tags and leftover markers. */
export function cleanRendered(html: string): string {
  return html
    .split(FRONT_SIDE_MARKER)
    .join('')
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/\[anki:tts[^\]]*\][\s\S]*?\[\/anki:tts\]/g, '')
    .trim();
}

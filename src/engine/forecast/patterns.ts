/**
 * Error-pattern mining (forecast guide, step 8).
 *
 * The analysis notes you write after each mock are the richest evidence in
 * the app and were being ignored. This tags each mock's notes into the eight
 * behaviour categories, tracks each category across mocks, and flags notes
 * that tell you to do opposite things - conflicting self-rules are a common
 * cause of freezing mid-paper.
 *
 * It is keyword matching, and it says so: tags are evidence for you to read,
 * not a diagnosis.
 */
import { formatDate } from '../../domain/date';
import type { ISODate } from '../../domain/types';
import type { CleanMock } from './hygiene';

export type PatternTag =
  | 'SUNK_COST'
  | 'PANIC_OR_CARELESS'
  | 'SELECTION'
  | 'SCANNING'
  | 'PACE'
  | 'ACCURACY_UNDER_PRESSURE'
  | 'CONCEPT_GAP'
  | 'STRATEGY_OVERLOAD';

export const PATTERN_LABELS: Record<PatternTag, string> = {
  SUNK_COST: 'Sunk cost',
  PANIC_OR_CARELESS: 'Panic or careless',
  SELECTION: 'Selection',
  SCANNING: 'Scanning',
  PACE: 'Pace',
  ACCURACY_UNDER_PRESSURE: 'Accuracy under pressure',
  CONCEPT_GAP: 'Concept gap',
  STRATEGY_OVERLOAD: 'Strategy overload',
};

/**
 * Phrases rather than single words where a single word would be too broad.
 * "time" alone appears in half of all notes; "ran out of time" does not.
 */
const KEYWORDS: Record<PatternTag, RegExp[]> = {
  SUNK_COST: [
    /\bstuck\b/, /sunk cost/, /spent too (?:long|much)/, /too much time on/, /couldn'?t (?:let go|leave)/,
    /kept (?:trying|going|at)/, /didn'?t (?:let go|leave|move on)/, /wasted \d* ?min/, /dragged/, /hung on/,
  ],
  PANIC_OR_CARELESS: [
    /\bpanic/, /careless/, /\bsilly\b/, /calculation (?:error|mistake)/, /\bmisread/, /\brushed\b/,
    /\bblank(?:ed)? out/, /\bnervous/, /\banxious/, /sign error/, /misunderst/, /\bfroze\b/,
  ],
  SELECTION: [
    /selection/, /\bselected\b/, /picked (?:the )?wrong/, /wrong set/, /should (?:have )?(?:skipped|left)/,
    /chose (?:the )?wrong/, /attempted (?:the )?(?:hard|tough|difficult)/, /bad (?:choice|pick)/,
  ],
  SCANNING: [
    /\bscan/, /didn'?t see/, /missed (?:an )?easy/, /first pass/, /overlooked/, /didn'?t (?:read|look at) (?:all|every)/,
    /left easy/, /easy (?:ones|questions|sets) (?:left|unattempted|missed)/,
  ],
  PACE: [
    /ran out of time/, /\bslow\b/, /\bpace\b/, /\bpacing\b/, /\bspeed\b/, /couldn'?t finish/, /time pressure/,
    /\btiming\b/, /too slow/, /last \d+ min/, /\brushed at the end/,
  ],
  ACCURACY_UNDER_PRESSURE: [
    /\baccuracy\b/, /negative marks/, /\bguess/, /too many wrong/, /\bwrong answers\b/, /low accuracy/,
    /\binaccurate/, /\bnegatives\b/,
  ],
  CONCEPT_GAP: [
    /\bconcept/, /didn'?t know/, /\bformula/, /\bforgot/, /don'?t understand/, /weak topic/, /never (?:studied|learnt|learned)/,
    /\btheory\b/, /no idea/, /didn'?t understand/, /\bsyllabus/,
  ],
  STRATEGY_OVERLOAD: [
    /too many rules/, /\boverthink/, /second[- ]guess/, /changed (?:my )?(?:strategy|plan|approach)/,
    /confused about (?:the )?(?:approach|order)/, /\boverload/, /too many strategies/, /\bindecisi/,
  ],
};

export function tagText(text: string): PatternTag[] {
  const lower = text.toLowerCase();
  return (Object.keys(KEYWORDS) as PatternTag[]).filter((tag) => KEYWORDS[tag].some((re) => re.test(lower)));
}

export type PatternTrend = 'NEW' | 'IMPROVING' | 'PERSISTENT' | 'OCCASIONAL';

export interface PatternSummary {
  tag: PatternTag;
  /** Number of mocks whose notes carry the tag. */
  frequency: number;
  lastSeen: ISODate;
  trend: PatternTrend;
}

export interface Contradiction {
  first: { date: ISODate; text: string };
  second: { date: ISODate; text: string };
}

export interface PatternReport {
  /** Mocks that had any notes at all. */
  mocksWithNotes: number;
  patterns: PatternSummary[];
  contradictions: Contradiction[];
  /** Rule 8.4: topic or coverage work is only recommended when this holds. */
  conceptGapInTopTwo: boolean;
}

/**
 * Trend labels, in order of precedence:
 * - NEW        - seen in the last three mocks and never before them
 * - IMPROVING  - absent from the last three mocks
 * - PERSISTENT - present in at least a third of the last six
 * - OCCASIONAL - none of the above; still seen, but rarely
 */
function trendFor(presence: boolean[]): PatternTrend {
  const lastThree = presence.slice(-3);
  const earlier = presence.slice(0, -3);
  if (lastThree.some(Boolean) && !earlier.some(Boolean)) return 'NEW';
  if (!lastThree.some(Boolean)) return 'IMPROVING';
  const lastSix = presence.slice(-6);
  if (lastSix.filter(Boolean).length >= lastSix.length / 3) return 'PERSISTENT';
  return 'OCCASIONAL';
}

/* ------------------------------------------------------------------ */
/* Contradictions                                                      */
/* ------------------------------------------------------------------ */

const AVOID = /\b(never|don'?t|do not|avoid|skip|skipping|leave|leaving|drop|abandon|stop|no more|not attempt)\b/;
const APPROACH = /\b(always|must|attempt|attempting|start with|begin with|go for|stick with|solve|do all|finish)\b/;
const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'were', 'will', 'should', 'would', 'could', 'when', 'then',
  'than', 'them', 'they', 'their', 'there', 'what', 'which', 'only', 'more', 'less', 'much', 'very', 'just', 'also',
  'into', 'after', 'before', 'about', 'because', 'next', 'time', 'mock', 'paper', 'always', 'never', 'must',
  'avoid', 'skip', 'leave', 'drop', 'stop', 'attempt', 'start', 'begin', 'stick', 'solve', 'finish', 'dont',
  'skipping', 'leaving', 'attempting', 'abandon',
]);

/** Short domain words that carry meaning despite their length. */
const DOMAIN = new Set(['rc', 'va', 'qa', 'lr', 'di', 'tita', 'mcq', 'pj', 'set', 'sets', 'varc', 'dilr']);

function subjectWords(sentence: string): Set<string> {
  return new Set(
    sentence
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => (w.length >= 4 || DOMAIN.has(w)) && !STOPWORDS.has(w)),
  );
}

function polarity(sentence: string): 'avoid' | 'approach' | null {
  const lower = sentence.toLowerCase();
  if (AVOID.test(lower)) return 'avoid';
  if (APPROACH.test(lower)) return 'approach';
  return null;
}

/**
 * Two self-rules contradict when they are about the same thing and point in
 * opposite directions: "skip TITA in QA" on one date, "attempt every QA TITA"
 * on another. "The same thing" means at least two shared content words, or
 * one shared domain word like TITA or RC.
 */
export function findContradictions(mocks: CleanMock[]): Contradiction[] {
  const rules: { date: ISODate; text: string; polarity: 'avoid' | 'approach'; words: Set<string> }[] = [];
  for (const mock of mocks) {
    for (const note of mock.notes) {
      for (const sentence of note.text.split(/[.!?;\n]+/).map((s) => s.trim()).filter((s) => s.length > 8)) {
        const p = polarity(sentence);
        if (p) rules.push({ date: mock.date, text: sentence, polarity: p, words: subjectWords(sentence) });
      }
    }
  }

  const found: Contradiction[] = [];
  for (let i = 0; i < rules.length && found.length < 3; i += 1) {
    for (let j = i + 1; j < rules.length && found.length < 3; j += 1) {
      const a = rules[i];
      const b = rules[j];
      if (a.date === b.date || a.polarity === b.polarity) continue;
      const shared = [...a.words].filter((w) => b.words.has(w));
      if (shared.length >= 2 || shared.some((w) => DOMAIN.has(w))) {
        found.push({ first: { date: a.date, text: a.text }, second: { date: b.date, text: b.text } });
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export function minePatterns(fullMocks: CleanMock[]): PatternReport {
  const tagged = fullMocks.map((m) => ({
    date: m.date,
    tags: new Set(m.notes.flatMap((n) => tagText(n.text))),
    hasNotes: m.notes.length > 0,
  }));
  const withNotes = tagged.filter((t) => t.hasNotes);

  const patterns: PatternSummary[] = [];
  for (const tag of Object.keys(KEYWORDS) as PatternTag[]) {
    const presence = withNotes.map((t) => t.tags.has(tag));
    const frequency = presence.filter(Boolean).length;
    if (frequency === 0) continue;
    const lastIndex = presence.lastIndexOf(true);
    patterns.push({ tag, frequency, lastSeen: withNotes[lastIndex].date, trend: trendFor(presence) });
  }
  patterns.sort((a, b) => b.frequency - a.frequency || (a.lastSeen < b.lastSeen ? 1 : -1));

  return {
    mocksWithNotes: withNotes.length,
    patterns,
    contradictions: findContradictions(fullMocks),
    conceptGapInTopTwo: patterns.slice(0, 2).some((p) => p.tag === 'CONCEPT_GAP'),
  };
}

export function describeContradiction(c: Contradiction): string {
  return `On ${formatDate(c.first.date)} you wrote "${c.first.text}", and on ${formatDate(c.second.date)} "${c.second.text}". These pull in opposite directions; settle on one rule.`;
}

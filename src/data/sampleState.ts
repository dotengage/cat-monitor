/**
 * Sample data, for looking around before committing to anything.
 *
 * Twelve weeks of a plausible CAT preparation: full mocks climbing from the
 * low 40s to the high 60s, sectionals, practice, a study log, habits, weekly
 * reviews, and three flashcard decks studied most days.
 *
 * It is built the way a real user's data is built - by running the app's own
 * actions through its own reducer, week by week - rather than written out by
 * hand. So the planner generates each week from the one before, reviews are
 * real reviews, and the flashcards carry schedules the actual scheduler
 * produced. Every screen therefore shows exactly what it would show for
 * someone twelve weeks in. Randomness is seeded: the sample is the same every
 * time it is loaded.
 */
import { DEFAULT_EXAM_DATE } from '../config/catConfig';
import { addDays, daysBetween, startOfWeek } from '../domain/date';
import { uid } from '../domain/ids';
import type { AppState, ISODate, Mock, SectionKey, SectionScore } from '../domain/types';
import { hashString, seededRandom } from '../engine/forecast/stats';
import { buildQueue, pickNext } from '../flashcards/queue';
import { AGAIN, EASY, GOOD, HARD } from '../flashcards/scheduler';
import { reducer, type Action } from '../state/store';
import { createInitialState } from './defaultState';

const WEEKS = 12;
/** Cards added today and not yet studied, so the decks show new cards waiting. */
const FRESH_CARDS = 4;

/** Section sizes in the current CAT pattern. */
const QUESTIONS: Record<SectionKey, number> = { VARC: 24, DILR: 20, QA: 22 };

/** Full-mock marks, oldest first: a real climb, with real dips in it. */
const MOCK_MARKS = [41, 46, 44, 50, 53, 49, 57, 59, 55, 63, 67];

/** A provider's marks-to-percentile curve, harsher than the real exam's. */
const percentileFor = (marks: number) => Math.round((100 / (1 + Math.exp(-(-0.5 + 0.045 * marks)))) * 100) / 100;
const sectionPercentileFor = (marks: number) => Math.round((100 / (1 + Math.exp(-(-1.3 + 0.11 * marks)))) * 100) / 100;

const MISTAKE_NOTES = [
  'Spent too long on one DILR set and never came back. Silly calculation slip in QA percentages.',
  'Careless errors in QA - misread the question twice. RC accuracy fine, but slow on the long passage.',
  'Time management again: stuck on a TITA in QA for 6 minutes. Guessed on two para-jumbles.',
  'Picked the wrong DILR sets first. Concept gap in probability.',
  'Rushed VARC at the end, guessed three questions. Calculation mistakes in DI.',
  'Better selection in DILR. Still careless in arithmetic under time pressure.',
];

const LESSONS = [
  'Read every DILR set for two minutes before committing.',
  'Leave any QA question I cannot start in ninety seconds.',
  'Write the ratio down before substituting.',
  'Attempt RC passages in order of length, shortest first.',
];

/** Three real decks: the cards an aspirant actually makes. */
const DECKS: { name: string; description: string; cards: [string, string][] }[] = [
  {
    name: 'QA Formulas',
    description: 'Formulas and shortcuts worth knowing cold.',
    cards: [
      ['Successive percentage change of a% and b%', '<b>a + b + ab/100</b>'],
      ['Sum of the first n natural numbers', 'n(n + 1) / 2'],
      ['Sum of squares of the first n natural numbers', 'n(n + 1)(2n + 1) / 6'],
      ['Compound interest amount', 'P(1 + r/100)<sup>n</sup>'],
      ['Number of diagonals of an n-sided polygon', 'n(n − 3) / 2'],
      ['Work: A alone takes a days, B alone b days. Together?', 'ab / (a + b) days'],
      ['Average speed for equal distances at x and y', '2xy / (x + y)'],
      ['Number of factors of N = p<sup>a</sup>q<sup>b</sup>r<sup>c</sup>', '(a + 1)(b + 1)(c + 1)'],
      ['nC<sub>r</sub>', 'n! / (r!(n − r)!)'],
      ['Sum of an AP', '(n/2)(2a + (n − 1)d)'],
      ['Sum of an infinite GP with |r| &lt; 1', 'a / (1 − r)'],
      ['Area of an equilateral triangle of side a', '(√3/4)a<sup>2</sup>'],
      ['log<sub>a</sub>b × log<sub>b</sub>c', 'log<sub>a</sub>c'],
      ['Mixture: alligation rule', '(cheaper : dearer) = (d − m) : (m − c), where m is the mean price'],
    ],
  },
  {
    name: 'Vocabulary',
    description: 'Words that keep turning up in RC passages.',
    cards: [
      ['Ephemeral', 'Lasting a very short time'],
      ['Obfuscate', 'To make unclear or hard to understand'],
      ['Pragmatic', 'Dealing with things sensibly and realistically'],
      ['Equivocal', 'Open to more than one interpretation; ambiguous'],
      ['Laconic', 'Using very few words'],
      ['Sanguine', 'Optimistic, especially in a difficult situation'],
      ['Recalcitrant', 'Stubbornly uncooperative'],
      ['Didactic', 'Intended to teach; often patronisingly so'],
      ['Perfunctory', 'Done without care or interest, as a routine'],
      ['Esoteric', 'Understood by only a small, specialised group'],
      ['Ubiquitous', 'Present or found everywhere'],
      ['Tacit', 'Understood or implied without being stated'],
    ],
  },
  {
    name: 'DILR Patterns',
    description: 'Set types and the first move that cracks them.',
    cards: [
      ['Arrangement set with "not adjacent" clauses', 'Fix the most constrained person first, then branch on the two or three cases'],
      ['Venn diagram with "at least" data', 'Fill the centre first, then work outwards'],
      ['Tournament with points tables', 'Total points = matches × points per match; use it as a check'],
      ['Games and selections: maximise one quantity', 'Push every other quantity to its minimum'],
      ['Data table with missing cells', 'Find row and column totals before the individual cells'],
      ['Routes and networks', 'List degrees of every node; odd degrees decide where a path starts'],
      ['When to drop a set', 'No progress after 10-12 minutes: leave it and choose another'],
      ['Spider / radar chart sets', 'Convert to a table before answering anything'],
    ],
  },
];

function score(marks: number, questions: number, rand: () => number): SectionScore {
  // A plausible attempt count, then correct and incorrect that give these marks
  // under +3 / -1.
  const attempts = Math.min(questions, Math.max(4, Math.round(marks / 2.2 + 4 + rand() * 4)));
  const correct = Math.max(0, Math.min(attempts, Math.round((marks + attempts) / 4)));
  const incorrect = attempts - correct;
  const real = 3 * correct - incorrect;
  return { score: real, percentile: sectionPercentileFor(real), attempts, correct, incorrect };
}

export function buildSampleState(today: ISODate): AppState {
  const rand = seededRandom(hashString('cat-adaptive-tracker-sample'));
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  const examDate = DEFAULT_EXAM_DATE > addDays(today, 14) ? DEFAULT_EXAM_DATE : addDays(today, 45);
  const currentWeek = startOfWeek(today, createInitialState(today).settings.weekStartsOn);
  const firstWeek = addDays(currentWeek, -7 * (WEEKS - 1));

  let s = createInitialState(firstWeek);
  const run = (action: Action) => {
    s = reducer(s, action);
  };

  run({
    type: 'onboarding/complete',
    profile: { targetPercentile: 97, examDate, startDate: firstWeek },
    commitments: [
      {
        title: 'College lectures',
        type: 'college',
        startDate: firstWeek,
        endDate: examDate,
        recurrence: 'weekly',
        daysOfWeek: [1, 2, 3, 4, 5],
        hoursPerDay: 6,
        reducesCapacity: false,
        flexible: false,
      },
      {
        title: 'Family wedding',
        type: 'family',
        startDate: addDays(firstWeek, 38),
        endDate: addDays(firstWeek, 39),
        recurrence: 'once',
        daysOfWeek: [],
        hoursPerDay: 5,
        reducesCapacity: true,
        flexible: false,
      },
    ],
    today: firstWeek,
  });

  // Topic coverage: the heaviest topics worked on first, as they should be.
  const byWeight = [...s.topics].sort((a, b) => b.weight - a.weight);
  byWeight.forEach((topic, i) => {
    const share = i / byWeight.length;
    const status = share < 0.3 ? 'strong' : share < 0.55 ? 'practised' : share < 0.75 ? 'learning' : 'not-started';
    run({ type: 'topic/update', id: topic.id, patch: { status } });
  });
  const topicsOf = (section: SectionKey) => s.topics.filter((t) => t.section === section);

  // Flashcard decks; cards arrive over the first weeks, as they would.
  // Fixed ids: the scheduler seeds its interval fuzz from a card's id, so
  // random ids would make the sample differ from one load to the next.
  const deckIds = DECKS.map((deck, d) => {
    const id = `sample-deck-${d + 1}`;
    run({ type: 'fc/deck/add', id, name: deck.name, description: deck.description });
    return id;
  });
  const pendingCards = DECKS.flatMap((deck, d) => deck.cards.map(([front, back]) => ({ deckId: deckIds[d], front, back, tags: [deck.name.split(' ')[0].toLowerCase()] })));
  const cardDates = new Map<string, ISODate>();
  const totalCards = pendingCards.length;
  const totalDays = Math.max(1, daysBetween(firstWeek, today));

  // One full mock each Sunday that has already happened; the climb is aligned
  // so that the latest of them is the highest.
  const sundays = Array.from({ length: WEEKS - 1 }, (_, i) => addDays(firstWeek, 7 * (i + 1) + 6)).filter((d) => d < today).length;
  const marks = MOCK_MARKS.slice(-sundays);
  let mockIndex = 0;
  const habitIds = s.habits.filter((h) => h.active).map((h) => h.id);

  for (let w = 0; w < WEEKS; w += 1) {
    const weekStart = addDays(firstWeek, 7 * w);
    const isCurrent = weekStart === currentWeek;

    for (let d = 0; d < 7; d += 1) {
      const date = addDays(weekStart, d);
      if (date >= today) break;
      const weekend = d >= 5;

      // A full mock most Sundays, from the second week.
      if (d === 6 && w >= 1 && mockIndex < marks.length) {
        const total = marks[mockIndex];
        const shares = { VARC: 0.36 + (rand() - 0.5) * 0.06, DILR: 0.28 + (rand() - 0.5) * 0.08 } as Record<SectionKey, number>;
        const v = score(Math.round(total * shares.VARC), QUESTIONS.VARC, rand);
        const di = score(Math.round(total * shares.DILR), QUESTIONS.DILR, rand);
        const q = score(total - v.score - di.score, QUESTIONS.QA, rand);
        const overall = v.score + di.score + q.score;
        const last = mockIndex === marks.length - 1;
        const mock: Omit<Mock, 'id' | 'createdAt' | 'updatedAt'> = {
          kind: 'full',
          date,
          provider: pick(['SimCAT', 'AIMCAT', 'Cracku']),
          name: `Mock ${mockIndex + 1}`,
          overallScore: overall,
          overallPercentile: percentileFor(overall),
          sections: { VARC: v, DILR: di, QA: q },
          dilrSetsAttempted: 3 + Math.round(rand()),
          dilrSetsSolved: Math.min(4, 1 + Math.round(di.score / 9)),
          lessons: last ? [] : [pick(LESSONS), pick(LESSONS)].filter((l, i, a) => a.indexOf(l) === i),
          // The latest mock is left unanalysed, to show what that looks like.
          analysed: !last,
          analysedAt: last ? undefined : `${date}T20:00:00.000Z`,
          mainMistakes: last ? undefined : pick(MISTAKE_NOTES),
          timeNotes: last ? undefined : 'Lost about eight minutes in the middle section.',
          weakTopicIds: last ? [] : (['VARC', 'DILR', 'QA'] as SectionKey[]).map((sec) => pick(topicsOf(sec)).id),
        };
        run({ type: 'mock/add', mock });
        mockIndex += 1;
      }

      // A sectional most Wednesdays.
      if (d === 2 && w >= 2 && w % 2 === 0) {
        const section = (['DILR', 'QA', 'VARC'] as SectionKey[])[(w / 2) % 3];
        const sec = score(Math.round(14 + w * 0.8 + rand() * 4), QUESTIONS[section], rand);
        run({
          type: 'mock/add',
          mock: { kind: 'sectional', date, provider: 'SimCAT', name: `${section} sectional`, section, sections: { [section]: sec }, lessons: [], analysed: true, weakTopicIds: [] },
        });
      }

      // Practice, getting steadily more accurate.
      const sessions = weekend ? 2 : rand() < 0.75 ? 1 : 0;
      for (let k = 0; k < sessions; k += 1) {
        const section = pick(['VARC', 'DILR', 'QA', 'QA'] as SectionKey[]);
        const topic = pick(topicsOf(section).filter((t) => t.status !== 'not-started'));
        const attempted = section === 'DILR' ? 8 : 12 + Math.round(rand() * 8);
        const accuracy = Math.min(0.92, 0.55 + w * 0.025 + (rand() - 0.5) * 0.15);
        run({
          type: 'practice/add',
          session: {
            date,
            section,
            topicId: topic?.id,
            label: topic ? `${topic.name} practice` : `${section} practice`,
            attempted,
            correct: Math.round(attempted * accuracy),
            timeMin: 30 + Math.round(rand() * 30),
            difficulty: (2 + Math.round(rand() * 2)) as 2 | 3 | 4,
            confidence: (2 + Math.round(rand() * 2)) as 2 | 3 | 4,
            ...(section === 'DILR' ? { setsAttempted: 3, setsSolved: Math.min(3, 1 + Math.round(rand() * 2)), setMissReasons: ['chose-incorrectly'] } : {}),
          },
        });
      }

      // The study log, and habits - with the last stretch unbroken.
      if (rand() < 0.88 || date >= addDays(today, -9)) {
        for (const section of ['VARC', 'DILR', 'QA'] as SectionKey[]) {
          if (rand() < 0.35) continue;
          run({ type: 'day/study', date, section, minutes: 30 + Math.round(rand() * 60), topics: pick(topicsOf(section)).name });
        }
        for (const habitId of habitIds) {
          if (rand() < 0.8 || date >= addDays(today, -9)) run({ type: 'habit/toggle', date, habitId, done: true });
        }
      }

      // New cards arrive steadily all the way through, so the newest are still
      // being learnt - then study most days.
      const dayNumber = w * 7 + d;
      while (pendingCards.length > FRESH_CARDS && cardDates.size < Math.ceil(((dayNumber + 1) / totalDays) * (totalCards - FRESH_CARDS))) {
        for (const card of pendingCards.splice(0, 1)) {
          const id = `sample-card-${cardDates.size + 1}`;
          run({ type: 'fc/card/add', id, ...card });
          cardDates.set(id, date);
        }
      }
      if (rand() < 0.85) studyCards(date);
    }

    // The planned work: most of it done, some partly, a little missed.
    for (const task of s.tasks.filter((t) => t.weekStart === weekStart && t.status === 'planned' && t.date !== null && t.date < today)) {
      const roll = rand();
      if (roll < 0.74) run({ type: 'task/complete', id: task.id, actualMin: Math.round(task.estimateMin * (0.8 + rand() * 0.45)) });
      else if (roll < 0.86) run({ type: 'task/partial', id: task.id });
      else {
        run({ type: 'task/miss', id: task.id });
        // Older misses were decided on long ago; last week's still wait.
        if (weekStart < addDays(currentWeek, -7)) run({ type: 'task/update', id: task.id, patch: { needsDecision: false } });
      }
    }

    // The weekly review, which plans the week after.
    if (!isCurrent) {
      run({
        type: 'review/save',
        weekStart,
        today: addDays(weekStart, 7),
        answers: {
          completedNote: 'Most of the planned work, and every mock analysed.',
          missedNote: rand() < 0.5 ? 'Two practice blocks on the busiest college day.' : 'One revision session.',
          realityNote: w === 5 ? 'Family wedding took most of the weekend.' : 'A normal week.',
          energy: (rand() < 0.3 ? 2 : rand() < 0.8 ? 3 : 4) as 2 | 3 | 4,
          actualFocusedHours: Math.round(14 + w * 0.6 + rand() * 4),
          friction: pick(['Phone during practice', 'Late nights before college', 'Starting DILR sets too slowly']),
          wins: pick(['Best QA sectional yet', 'Kept the streak all week', 'Finally comfortable with arrangements']),
        },
      });
    }
  }

  // A study session on a day, run exactly as the study screen runs one: the
  // day's queue, learning cards coming back as their steps fall due, answers
  // the way a person gives them - mostly Good, sometimes Again.
  function studyCards(date: ISODate) {
    let now = new Date(`${date}T19:00:00`).getTime();
    const end = now + 3 * 60 * 60_000;
    const queue = buildQueue(s.decks, s.flashcards, s.cardReviews, now);
    const decks = new Set(s.decks.map((d) => d.id));
    for (let step = 0; step < 300 && now < end; step += 1) {
      const next = pickNext(queue, decks, s.flashcards, now);
      if (next.cardId) {
        const roll = rand();
        const rating = roll < 0.1 ? AGAIN : roll < 0.22 ? HARD : roll < 0.9 ? GOOD : EASY;
        run({ type: 'fc/answer', cardId: next.cardId, rating, now, timeMs: 4000 + Math.round(rand() * 9000), reviewId: uid('rev') });
        now += 9000;
      } else if (next.waitUntil) {
        now = Math.max(now + 1000, next.waitUntil);
      } else {
        break;
      }
    }
  }

  for (const card of pendingCards.splice(0)) {
    const id = `sample-card-${cardDates.size + 1}`;
    run({ type: 'fc/card/add', id, ...card });
    cardDates.set(id, today);
  }

  // Records carry the dates they belong to, not the moment the sample was made.
  s = {
    ...s,
    flashcards: s.flashcards.map((c) => (cardDates.has(c.id) ? { ...c, createdAt: `${cardDates.get(c.id)}T18:00:00.000Z` } : c)),
    tasks: s.tasks.map((t) => (t.completedAt && t.date ? { ...t, completedAt: `${t.date}T20:00:00.000Z` } : t)),
    demo: true,
  };
  return s;
}

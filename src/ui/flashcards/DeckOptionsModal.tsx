import { useState } from 'react';
import type { Deck, DeckOptions } from '../../domain/types';
import { DEFAULT_DECK_OPTIONS } from '../../flashcards/scheduler';
import { useStore } from '../../state/store';
import { Field, Modal } from '../components';

/** "1m 10m 1d" (or plain minutes, "1 10") into minutes. */
export function parseSteps(text: string): number[] | null {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const token of tokens) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(token);
    if (!m) return null;
    const value = Number(m[1]);
    const unit = m[2].toLowerCase() || 'm';
    out.push(unit === 's' ? value / 60 : unit === 'h' ? value * 60 : unit === 'd' ? value * 1440 : value);
  }
  return out.filter((v) => v > 0);
}

export function formatSteps(steps: number[]): string {
  return steps
    .map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${Math.round(m * 100) / 100}m`))
    .join(' ');
}

const NUMBER_FIELDS: { key: keyof DeckOptions; label: string; hint: string; step?: number; percent?: boolean }[] = [
  { key: 'newPerDay', label: 'New cards/day', hint: 'How many new cards are introduced each day.' },
  { key: 'reviewsPerDay', label: 'Maximum reviews/day', hint: 'Upper limit on review cards shown each day.' },
  { key: 'graduatingInterval', label: 'Graduating interval (days)', hint: 'After the last learning step, on Good.' },
  { key: 'easyInterval', label: 'Easy interval (days)', hint: 'When Easy is pressed on a learning card.' },
  { key: 'startingEase', label: 'Starting ease', hint: '250% by default.', percent: true },
  { key: 'easyBonus', label: 'Easy bonus', hint: 'Extra multiplier for Easy on a review card. 130% by default.', percent: true },
  { key: 'hardInterval', label: 'Hard interval', hint: 'Multiplier for Hard on a review card. 120% by default.', percent: true },
  { key: 'intervalModifier', label: 'Interval modifier', hint: 'Scales every review interval. 100% does nothing.', percent: true },
  { key: 'newInterval', label: 'New interval', hint: 'Share of the interval kept after a lapse. 0% starts over.', percent: true },
  { key: 'minimumInterval', label: 'Minimum interval (days)', hint: 'Shortest interval after a lapse.' },
  { key: 'maximumInterval', label: 'Maximum interval (days)', hint: '36,500 days (100 years) by default.' },
  { key: 'leechThreshold', label: 'Leech threshold', hint: 'Lapses before a card is tagged as a leech.' },
];

export function DeckOptionsModal({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description);
  const [options, setOptions] = useState<DeckOptions>(deck.options);
  const [learn, setLearn] = useState(formatSteps(deck.options.learnSteps));
  const [relearn, setRelearn] = useState(formatSteps(deck.options.relearnSteps));
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const learnSteps = parseSteps(learn);
    const relearnSteps = parseSteps(relearn);
    if (!learnSteps || learnSteps.length === 0) {
      setProblem('Learning steps need at least one value, such as "1m 10m".');
      return;
    }
    if (!relearnSteps) {
      setProblem('Relearning steps must be values such as "10m", or left empty.');
      return;
    }
    dispatch({ type: 'fc/deck/update', id: deck.id, name, description, options: { ...options, learnSteps, relearnSteps } });
    onClose();
  };

  return (
    <Modal
      title={`Options for ${deck.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
          <button
            type="button"
            className="btn subtle"
            onClick={() => {
              setOptions(DEFAULT_DECK_OPTIONS);
              setLearn(formatSteps(DEFAULT_DECK_OPTIONS.learnSteps));
              setRelearn(formatSteps(DEFAULT_DECK_OPTIONS.relearnSteps));
            }}
          >
            Restore Anki defaults
          </button>
        </>
      }
    >
      <Field label="Deck name" htmlFor="do-name">
        <input id="do-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="do-desc">
        <textarea id="do-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </Field>

      <div className="inline-fields-2">
        <Field label="Learning steps" htmlFor="do-learn" hint="Minutes by default; 1m 10m 1d also works.">
          <input id="do-learn" type="text" value={learn} onChange={(e) => setLearn(e.target.value)} />
        </Field>
        <Field label="Relearning steps" htmlFor="do-relearn" hint="For cards you forget. Empty skips relearning.">
          <input id="do-relearn" type="text" value={relearn} onChange={(e) => setRelearn(e.target.value)} />
        </Field>
      </div>

      <div className="inline-fields-2">
        {NUMBER_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`do-${f.key}`} hint={f.hint}>
            <input
              id={`do-${f.key}`}
              type="number"
              min={0}
              step={f.percent ? 5 : 1}
              value={f.percent ? Math.round((options[f.key] as number) * 100) : (options[f.key] as number)}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (!Number.isFinite(raw)) return;
                setOptions((o) => ({ ...o, [f.key]: f.percent ? raw / 100 : raw }));
              }}
            />
          </Field>
        ))}
      </div>

      {problem && (
        <p className="small" style={{ color: 'var(--risk)' }}>
          {problem}
        </p>
      )}
      <p className="tiny faint">These are Anki's own settings and defaults. Changes apply from each card's next answer.</p>
    </Modal>
  );
}

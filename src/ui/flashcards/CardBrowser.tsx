import { useMemo, useState } from 'react';
import type { Flashcard } from '../../domain/types';
import { toPlainText } from '../../flashcards/html';
import { formatDays } from '../../flashcards/scheduler';
import { searchCards } from '../../flashcards/search';
import { useStore } from '../../state/store';
import { Empty, Modal } from '../components';
import { CardContent, RichField } from './CardContent';

type SortKey = 'sort' | 'due' | 'deck' | 'interval' | 'ease' | 'lapses' | 'created';
const PAGE = 150;

function dueText(card: Flashcard): string {
  if (card.suspended) return '(suspended)';
  if (card.state === 'new') return `New #${card.position}`;
  const date = new Date(card.due);
  if (card.state === 'learning' || card.state === 'relearning') {
    return date.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Anki's Browse window: every card, searchable, with the selected card
 * editable beside the list. Edits save as you leave a field.
 */
export function CardBrowser({ initialDeckId }: { initialDeckId?: string }) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState('');
  const [deckFilter, setDeckFilter] = useState(initialDeckId ?? '');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'created', desc: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [previewing, setPreviewing] = useState<Flashcard | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const deckNames = useMemo(() => new Map(state.decks.map((d) => [d.id, d.name])), [state.decks]);
  const now = Date.now();

  const rows = useMemo(() => {
    const pool = deckFilter ? state.flashcards.filter((c) => c.deckId === deckFilter) : state.flashcards;
    const found = searchCards(pool, state.decks, query, now);
    const value = (c: Flashcard): string | number => {
      switch (sort.key) {
        case 'sort':
          return toPlainText(c.front).toLowerCase();
        case 'due':
          return c.state === 'new' ? Number.MAX_SAFE_INTEGER - 1e9 + c.position : c.due;
        case 'deck':
          return (deckNames.get(c.deckId) ?? '').toLowerCase();
        case 'interval':
          return c.state === 'review' ? c.interval : -1;
        case 'ease':
          return c.state === 'review' ? c.ease : 0;
        case 'lapses':
          return c.lapses;
        case 'created':
          return c.createdAt;
      }
    };
    return [...found].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -order : order;
    });
    // `now` changes every render; the list only needs to follow the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckFilter, deckNames, query, sort, state.decks, state.flashcards]);

  const active = activeId ? state.flashcards.find((c) => c.id === activeId) : undefined;
  const selection = [...selected].filter((id) => state.flashcards.some((c) => c.id === id));

  const header = (key: SortKey, label: string, className?: string) => (
    <th className={className}>
      <button
        type="button"
        className={`sort-head${sort.key === key ? ' active' : ''}`}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
      </button>
    </th>
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownSelected = rows.slice(0, limit).length > 0 && rows.slice(0, limit).every((c) => selected.has(c.id));

  return (
    <div className="browser">
      <div className="browser-bar">
        <input
          type="search"
          className="browser-search"
          placeholder="Search: words, deck:name, tag:x, is:due, is:new, is:suspended, -is:leech"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
        />
        <select value={deckFilter} onChange={(e) => setDeckFilter(e.target.value)} aria-label="Deck">
          <option value="">All decks</option>
          {state.decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="tiny muted">
          {rows.length} card{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {selection.length > 0 && (
        <div className="bulk-bar">
          <strong className="small">{selection.length} selected</strong>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to deck">
            <option value="">Move to…</option>
            {state.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn small"
            disabled={!moveTo}
            onClick={() => {
              dispatch({ type: 'fc/cards/move', ids: selection, deckId: moveTo });
              setMoveTo('');
            }}
          >
            Move
          </button>
          <button type="button" className="btn small" onClick={() => dispatch({ type: 'fc/cards/suspend', ids: selection, suspended: true })}>
            Suspend
          </button>
          <button type="button" className="btn small" onClick={() => dispatch({ type: 'fc/cards/suspend', ids: selection, suspended: false })}>
            Unsuspend
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (window.confirm(`Reset ${selection.length} card(s) to new? Their review history is kept.`)) {
                dispatch({ type: 'fc/cards/forget', ids: selection });
              }
            }}
          >
            Forget
          </button>
          <button
            type="button"
            className="btn small danger"
            onClick={() => {
              if (window.confirm(`Delete ${selection.length} card(s)? This cannot be undone.`)) {
                dispatch({ type: 'fc/cards/delete', ids: selection });
                setSelected(new Set());
              }
            }}
          >
            Delete
          </button>
          <button type="button" className="btn small subtle" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className={`browser-split${active ? ' with-editor' : ''}`}>
        <div className="browser-list">
          {rows.length === 0 ? (
            <Empty>{state.flashcards.length === 0 ? 'No cards yet. Add some, or import an Anki package.' : 'No cards match.'}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="browser-table">
                <thead>
                  <tr>
                    <th className="check">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allShownSelected}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            for (const c of rows.slice(0, limit)) {
                              if (allShownSelected) next.delete(c.id);
                              else next.add(c.id);
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                    {header('sort', 'Sort field')}
                    {header('due', 'Due')}
                    {header('deck', 'Deck')}
                    {header('interval', 'Interval', 'num')}
                    {header('ease', 'Ease', 'num opt')}
                    {header('lapses', 'Lapses', 'num opt')}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((c) => (
                    <tr
                      key={c.id}
                      className={`${c.id === activeId ? 'active' : ''}${c.suspended ? ' suspended' : ''}`}
                      onClick={() => setActiveId(c.id)}
                    >
                      <td className="check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Select card" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                      <td className="sort-field">{toPlainText(c.front).slice(0, 80) || '(empty)'}</td>
                      <td className="nowrap">{dueText(c)}</td>
                      <td className="nowrap">{deckNames.get(c.deckId) ?? '?'}</td>
                      <td className="num mono">{c.state === 'review' ? formatDays(c.interval) : '—'}</td>
                      <td className="num mono opt">{c.state === 'review' ? `${Math.round(c.ease * 100)}%` : '—'}</td>
                      <td className="num mono opt">{c.lapses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > limit && (
            <button type="button" className="btn small" style={{ marginTop: 10 }} onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, rows.length - limit)} more
            </button>
          )}
        </div>

        {active && (
          <InlineEditor
            key={active.id}
            card={active}
            onPreview={() => setPreviewing(active)}
            onClose={() => setActiveId(null)}
          />
        )}
      </div>

      {previewing && <PreviewModal card={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

function InlineEditor({ card, onPreview, onClose }: { card: Flashcard; onPreview: () => void; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [tags, setTags] = useState(card.tags.join(' '));

  const save = (patch: { front?: string; back?: string; tags?: string[]; deckId?: string }) => dispatch({ type: 'fc/card/update', id: card.id, ...patch });

  // Saving on every focus change would stamp the card as edited - and send
  // it through sync - even when nothing was touched.
  const saveIfChanged = () => {
    const nextTags = tags.split(/[\s,]+/).filter(Boolean);
    if (front !== card.front || back !== card.back || nextTags.join(' ') !== card.tags.join(' ')) {
      save({ front, back, tags: nextTags });
    }
  };

  return (
    <aside className="browser-editor" onBlur={saveIfChanged}>
      <div className="row-between">
        <strong className="small">Edit card</strong>
        <div className="row">
          <button type="button" className="btn small" onClick={onPreview}>
            Preview
          </button>
          <button type="button" className="btn small subtle" onClick={onClose} aria-label="Close editor">
            ✕
          </button>
        </div>
      </div>
      <label className="tiny muted" htmlFor="be-deck">
        Deck
      </label>
      <select id="be-deck" value={card.deckId} onChange={(e) => save({ deckId: e.target.value })}>
        {state.decks.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <RichField label="Front" value={front} onChange={setFront} />
      <RichField label="Back" value={back} onChange={setBack} />
      <label className="tiny muted" htmlFor="be-tags">
        Tags
      </label>
      <input id="be-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
      <div className="tiny faint" style={{ marginTop: 8 }}>
        {card.reps} review{card.reps === 1 ? '' : 's'} · {card.lapses} lapse{card.lapses === 1 ? '' : 's'}
        {card.leech ? ' · leech' : ''} · added {new Date(card.createdAt).toLocaleDateString()}
      </div>
    </aside>
  );
}

/** Front, then a flip to the back, exactly as it will appear when studying. */
export function PreviewModal({ card, onClose }: { card: Flashcard; onClose: () => void }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Modal
      title="Preview"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary" onClick={() => setRevealed((r) => !r)}>
          {revealed ? 'Show front' : 'Show answer'}
        </button>
      }
    >
      <div className="flip-scene">
        <div className={`flip-card${revealed ? ' flipped' : ''}`} onClick={() => setRevealed((r) => !r)}>
          <div className="flip-face flip-front">
            <CardContent html={card.front} />
          </div>
          <div className="flip-face flip-back">
            <CardContent html={card.front} className="question-echo" />
            <hr className="answer-rule" />
            <CardContent html={card.back} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

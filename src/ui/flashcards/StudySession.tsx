import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Flashcard, Rating } from '../../domain/types';
import { uid } from '../../domain/ids';
import { buildQueue, pickNext, sessionCounts } from '../../flashcards/queue';
import { DEFAULT_DECK_OPTIONS, formatOutcome, outcomes } from '../../flashcards/scheduler';
import { useStore } from '../../state/store';
import { ActionMenu } from '../components';
import { CardContent } from './CardContent';
import { CardEditorModal } from './CardEditorModal';

const BUTTONS: { rating: Rating; label: string; key: string; tone: string }[] = [
  { rating: 1, label: 'Again', key: '1', tone: 'again' },
  { rating: 2, label: 'Hard', key: '2', tone: 'hard' },
  { rating: 3, label: 'Good', key: '3', tone: 'good' },
  { rating: 4, label: 'Easy', key: '4', tone: 'easy' },
];

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)} seconds`;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * One study session over one or more decks.
 *
 * The queue - the day's reviews and new cards - is fixed when the session
 * starts, as in Anki; learning cards are looked up live, because they come
 * back within minutes of being answered.
 */
export function StudySession({ deckIds, title, onExit }: { deckIds: string[]; title: string; onExit: () => void }) {
  const { state, dispatch } = useStore();
  const decks = useMemo(() => state.decks.filter((d) => deckIds.includes(d.id)), [state.decks, deckIds]);
  const deckSet = useMemo(() => new Set(deckIds), [deckIds]);
  const [queue] = useState(() => buildQueue(decks, state.flashcards, state.cardReviews, Date.now()));

  const [currentId, setCurrentId] = useState<string | undefined>();
  const [waitUntil, setWaitUntil] = useState<number | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [history, setHistory] = useState<{ card: Flashcard; reviewId: string }[]>([]);
  const [session, setSession] = useState({ studied: 0, again: 0, timeMs: 0, started: Date.now() });
  const [rated, setRated] = useState<{ tone: string; text: string; key: number } | null>(null);
  const [editing, setEditing] = useState<Flashcard | null>(null);
  const [tick, setTick] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const card = currentId ? state.flashcards.find((c) => c.id === currentId) : undefined;
  const options = (card && state.decks.find((d) => d.id === card.deckId)?.options) || DEFAULT_DECK_OPTIONS;

  // Choose the next card whenever there is none on screen.
  useEffect(() => {
    if (currentId && card) return;
    const pick = pickNext(queue, deckSet, state.flashcards, Date.now());
    setCurrentId(pick.cardId);
    setWaitUntil(pick.waitUntil);
    setRevealed(false);
    setShownAt(Date.now());
  }, [card, currentId, deckSet, queue, state.flashcards, tick]);

  // When waiting on a learning card, wake up when it is due.
  useEffect(() => {
    if (!waitUntil) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), Math.max(500, waitUntil - Date.now() + 250));
    return () => window.clearTimeout(id);
  }, [waitUntil]);

  const preview = useMemo(() => (card ? outcomes(card, options, Date.now()) : null), [card, options]);
  const counts = sessionCounts(queue, deckSet, state.flashcards, Date.now());
  const remaining = counts.newCount + counts.learning + counts.review;
  const progress = session.studied + remaining === 0 ? 1 : session.studied / (session.studied + remaining);

  const reveal = useCallback(() => setRevealed(true), []);

  const rate = useCallback(
    (rating: Rating) => {
      if (!card || !revealed || !preview) return;
      const now = Date.now();
      const reviewId = uid('rev');
      const timeMs = now - shownAt;
      dispatch({ type: 'fc/answer', cardId: card.id, rating, now, timeMs, reviewId });
      setHistory((h) => [...h.slice(-30), { card, reviewId }]);
      setSession((s) => ({ ...s, studied: s.studied + 1, again: s.again + (rating === 1 ? 1 : 0), timeMs: s.timeMs + Math.min(timeMs, 60_000) }));
      const button = BUTTONS[rating - 1];
      setRated({ tone: button.tone, text: `${button.label} · ${formatOutcome(preview[rating])}`, key: now });
      setCurrentId(undefined);
    },
    [card, dispatch, preview, revealed, shownAt],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    dispatch({ type: 'fc/undo', card: last.card, reviewId: last.reviewId });
    setHistory((h) => h.slice(0, -1));
    setSession((s) => ({ ...s, studied: Math.max(0, s.studied - 1) }));
    setCurrentId(last.card.id);
    setRevealed(false);
    setShownAt(Date.now());
  }, [dispatch, history]);

  // Anki's keys: Space or Enter to show and then to answer Good, 1-4 to rate,
  // E to edit, Z or Ctrl+Z to undo, Escape to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!card) return;
        if (!revealed) reveal();
        else rate(3);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        rate(Number(e.key) as Rating);
      } else if ((e.key === 'z' || e.key === 'Z') && !e.altKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'e' || e.key === 'E') && card) {
        setEditing(card);
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [card, editing, onExit, rate, reveal, revealed, undo]);

  useEffect(() => {
    if (!rated) return;
    const id = window.setTimeout(() => setRated(null), 900);
    return () => window.clearTimeout(id);
  }, [rated]);

  const cardKind = card?.state === 'new' ? 'new' : card?.state === 'review' ? 'review' : 'learning';

  return (
    <div className="study">
      <div className="study-top">
        <button type="button" className="btn small subtle" onClick={onExit} title="Esc">
          ← Decks
        </button>
        <div className="study-title">
          <strong>{title}</strong>
          <span className="study-counts" aria-label={`${counts.newCount} new, ${counts.learning} learning, ${counts.review} to review`}>
            <span className={`count-new${cardKind === 'new' ? ' current' : ''}`}>{counts.newCount}</span>
            <span className={`count-learn${cardKind === 'learning' ? ' current' : ''}`}>{counts.learning}</span>
            <span className={`count-review${cardKind === 'review' ? ' current' : ''}`}>{counts.review}</span>
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn small subtle" onClick={undo} disabled={history.length === 0} title="Undo (Z)">
            Undo
          </button>
          {card && (
            <ActionMenu
              label="Card actions"
              items={[
                { label: 'Edit card (E)', onClick: () => setEditing(card) },
                {
                  label: 'Suspend card',
                  onClick: () => {
                    dispatch({ type: 'fc/cards/suspend', ids: [card.id], suspended: true });
                    setCurrentId(undefined);
                  },
                },
                {
                  label: 'Delete card',
                  danger: true,
                  onClick: () => {
                    if (!window.confirm('Delete this card? Its review history is kept.')) return;
                    dispatch({ type: 'fc/cards/delete', ids: [card.id] });
                    setCurrentId(undefined);
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="study-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="study-stage" ref={stageRef}>
        {rated && (
          <div key={rated.key} className={`rated-pill rated-${rated.tone}`} aria-live="polite">
            {rated.text}
          </div>
        )}

        {card ? (
          <div key={card.id + (history.length > 0 ? `-${history.length}` : '')} className="flip-scene card-in">
            <div
              className={`flip-card${revealed ? ' flipped' : ''}`}
              onClick={() => !revealed && reveal()}
              role={revealed ? undefined : 'button'}
              tabIndex={revealed ? undefined : 0}
              aria-label={revealed ? undefined : 'Show answer'}
            >
              <div className="flip-face flip-front">
                <CardContent html={card.front} />
                {!revealed && <div className="tap-hint tiny muted">Tap or press Space to show the answer</div>}
              </div>
              <div className="flip-face flip-back" aria-hidden={!revealed}>
                <CardContent html={card.front} className="question-echo" />
                <hr className="answer-rule" />
                <CardContent html={card.back} />
              </div>
            </div>
            {card.leech && <div className="leech-note tiny">Leech: this card keeps lapsing. Consider rewriting or splitting it.</div>}
          </div>
        ) : (
          <FinishScreen session={session} waitUntil={waitUntil} onExit={onExit} />
        )}
      </div>

      {card && (
        <div className="study-answer">
          {!revealed ? (
            <button type="button" className="btn primary show-answer" onClick={reveal}>
              Show answer <kbd>Space</kbd>
            </button>
          ) : (
            <div className="rating-row">
              {BUTTONS.map((b) => (
                <button key={b.rating} type="button" className={`rate-btn rate-${b.tone}`} onClick={() => rate(b.rating)}>
                  <span className="rate-ivl">{preview ? formatOutcome(preview[b.rating]) : ''}</span>
                  <span className="rate-label">{b.label}</span>
                  <kbd>{b.key}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && <CardEditorModal card={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FinishScreen({
  session,
  waitUntil,
  onExit,
}: {
  session: { studied: number; again: number; timeMs: number };
  waitUntil?: number;
  onExit: () => void;
}) {
  const passRate = session.studied > 0 ? Math.round(((session.studied - session.again) / session.studied) * 100) : null;
  return (
    <div className="finish">
      <svg className="finish-check" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="24" />
        <path d="M15 27l7 7 15-16" />
      </svg>
      <h2>{waitUntil ? 'Nothing due right now' : 'Congratulations! You have finished this deck for now.'}</h2>
      {session.studied > 0 && (
        <p className="small muted">
          {session.studied} card{session.studied === 1 ? '' : 's'} in {duration(session.timeMs)}
          {passRate !== null ? ` · ${passRate}% not Again` : ''}
        </p>
      )}
      {waitUntil && (
        <p className="small">
          A learning card is due again at <strong>{clock(waitUntil)}</strong>. This screen will pick it up by itself.
        </p>
      )}
      <button type="button" className="btn primary" onClick={onExit}>
        Back to decks
      </button>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { Flashcard } from '../../domain/types';
import { uid } from '../../domain/ids';
import { isBlank } from '../../flashcards/html';
import { useStore } from '../../state/store';
import { Field, Modal } from '../components';
import { RichField } from './CardContent';

const LAST_DECK_KEY = 'cat-monitor:fc-last-deck';

function rememberedDeck(): string | null {
  try {
    return localStorage.getItem(LAST_DECK_KEY);
  } catch {
    return null;
  }
}

function rememberDeck(id: string) {
  try {
    localStorage.setItem(LAST_DECK_KEY, id);
  } catch {
    /* a convenience only */
  }
}

const parseTags = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/**
 * Anki's Add window, and its Edit window.
 *
 * Adding keeps the window open and clears the two sides, because cards are
 * usually made in batches; the deck and tags stay, for the same reason.
 * Ctrl+Enter adds, as in Anki.
 */
export function CardEditorModal({
  card,
  defaultDeckId,
  onClose,
}: {
  /** Present when editing an existing card. */
  card?: Flashcard;
  defaultDeckId?: string;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const decks = state.decks;
  const editing = Boolean(card);

  const initialDeck =
    card?.deckId ??
    (defaultDeckId && decks.some((d) => d.id === defaultDeckId) ? defaultDeckId : undefined) ??
    (decks.find((d) => d.id === rememberedDeck())?.id ?? decks[0]?.id ?? '');

  const [deckId, setDeckId] = useState(initialDeck);
  const [newDeckName, setNewDeckName] = useState('');
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [tags, setTags] = useState(card?.tags.join(' ') ?? '');
  const [added, setAdded] = useState(0);
  const [flash, setFlash] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);

  const creatingDeck = deckId === '__new__' || decks.length === 0;

  const submit = useCallback(() => {
    if (isBlank(front)) {
      setProblem('The front is empty. Type something or paste a screenshot.');
      return;
    }
    let targetDeck = deckId;
    if (creatingDeck) {
      const name = newDeckName.trim();
      if (!name) {
        setProblem('Name the new deck first.');
        return;
      }
      targetDeck = uid('deck');
      dispatch({ type: 'fc/deck/add', id: targetDeck, name });
      setDeckId(targetDeck);
      setNewDeckName('');
    }
    setProblem(null);
    rememberDeck(targetDeck);

    if (card) {
      dispatch({ type: 'fc/card/update', id: card.id, front, back, tags: parseTags(tags), deckId: targetDeck });
      onClose();
      return;
    }

    dispatch({ type: 'fc/card/add', deckId: targetDeck, front, back, tags: parseTags(tags) });
    setFront('');
    setBack('');
    setAdded((n) => n + 1);
    setFlash(true);
    setFocusKey((k) => k + 1);
    window.setTimeout(() => setFlash(false), 900);
  }, [back, card, creatingDeck, deckId, dispatch, front, newDeckName, onClose, tags]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [submit]);

  return (
    <Modal
      title={editing ? 'Edit card' : 'Add cards'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={submit} title="Ctrl+Enter">
            {editing ? 'Save' : 'Add'}
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            {editing ? 'Cancel' : 'Close'}
          </button>
          {!editing && added > 0 && (
            <span className={`added-note${flash ? ' show' : ''}`}>
              {added} added this time
            </span>
          )}
        </>
      }
    >
      <div className="inline-fields-2">
        <Field label="Type" htmlFor="fc-type">
          <select id="fc-type" disabled value="basic">
            <option value="basic">Basic</option>
          </select>
        </Field>
        <Field label="Deck" htmlFor="fc-deck">
          <select id="fc-deck" value={creatingDeck ? '__new__' : deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="__new__">+ New deck…</option>
          </select>
        </Field>
      </div>
      {creatingDeck && (
        <Field label="New deck name" htmlFor="fc-newdeck">
          <input
            id="fc-newdeck"
            type="text"
            value={newDeckName}
            placeholder="e.g. QA Hacks"
            onChange={(e) => setNewDeckName(e.target.value)}
          />
        </Field>
      )}

      <RichField key={`front-${focusKey}`} label="Front" value={front} onChange={setFront} autoFocus />
      <RichField label="Back" value={back} onChange={setBack} />

      <Field label="Tags" htmlFor="fc-tags" hint="Separate with spaces.">
        <input id="fc-tags" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="qa ratios" />
      </Field>

      {problem && (
        <p className="small" style={{ color: 'var(--risk)' }}>
          {problem}
        </p>
      )}
      {!editing && <p className="tiny faint">Ctrl+V pastes a screenshot into whichever side has the cursor. Ctrl+Enter adds the card.</p>}
    </Modal>
  );
}

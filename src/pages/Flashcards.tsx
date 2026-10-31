import { useEffect, useMemo, useRef, useState } from 'react';
import type { Deck } from '../domain/types';
import { downloadCollection, importPackage, type ImportSummary } from '../flashcards/colpkg';
import { deckCounts } from '../flashcards/queue';
import { useStore } from '../state/store';
import { ActionMenu, Callout, Card, Empty } from '../ui/components';
import { CardBrowser } from '../ui/flashcards/CardBrowser';
import { CardEditorModal } from '../ui/flashcards/CardEditorModal';
import { DeckOptionsModal } from '../ui/flashcards/DeckOptionsModal';
import { FlashcardStats } from '../ui/flashcards/FlashcardStats';
import { StudySession } from '../ui/flashcards/StudySession';

type View = 'decks' | 'deck' | 'study' | 'browse' | 'stats';

/**
 * Sub-views live in the hash (`#/flashcards?view=study&deck=...`) rather than
 * in component state, so the back button - and the back gesture on a phone -
 * leaves a study session instead of leaving the app.
 */
function useFlashcardRoute(): [{ view: View; deck?: string }, (view: View, deck?: string) => void] {
  const read = () => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const view = (q.get('view') as View) || 'decks';
    return { view: ['decks', 'deck', 'study', 'browse', 'stats'].includes(view) ? view : 'decks', deck: q.get('deck') ?? undefined };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const go = (view: View, deck?: string) => {
    const q = new URLSearchParams();
    if (view !== 'decks') q.set('view', view);
    if (deck) q.set('deck', deck);
    const query = q.toString();
    window.location.hash = `/flashcards${query ? `?${query}` : ''}`;
  };
  return [route, go];
}

export function Flashcards() {
  const { state, dispatch } = useStore();
  const [route, go] = useFlashcardRoute();
  const [adding, setAdding] = useState<{ deckId?: string } | null>(null);
  const [optionsFor, setOptionsFor] = useState<Deck | null>(null);
  const [newDeck, setNewDeck] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | { error: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const now = Date.now();
  const counts = useMemo(
    () => new Map(state.decks.map((d) => [d.id, deckCounts(d, state.flashcards, state.cardReviews, now)])),
    // Recomputed whenever the cards or their history change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.decks, state.flashcards, state.cardReviews],
  );
  const resetDeck = (target: Deck) => {
    const cards = state.flashcards.filter((c) => c.deckId === target.id);
    const n = cards.length;
    if (n === 0) return;
    const ask = `Reset learning progress in "${target.name}"? ${n === 1 ? 'Its card goes' : `All ${n} cards go`} back to new and start again from scratch. Your review history and stats are kept. This cannot be undone.`;
    if (window.confirm(ask)) dispatch({ type: 'fc/cards/forget', ids: cards.map((c) => c.id) });
  };
  const totals = [...counts.values()].reduce(
    (a, c) => ({ newCount: a.newCount + c.newCount, learning: a.learning + c.learning, review: a.review + c.review }),
    { newCount: 0, learning: 0, review: 0 },
  );

  const deck = route.deck ? state.decks.find((d) => d.id === route.deck) : undefined;

  if (route.view === 'study') {
    const ids = route.deck === 'all' || !deck ? state.decks.map((d) => d.id) : [deck.id];
    return (
      <StudySession
        key={route.deck ?? 'all'}
        deckIds={ids}
        title={deck ? deck.name : 'All decks'}
        onExit={() => go(deck ? 'deck' : 'decks', deck?.id)}
      />
    );
  }

  const runImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importPackage(file, state);
      dispatch({ type: 'fc/import', decks: result.decks, cards: result.cards, reviews: result.reviews });
      setImportResult(result.summary);
    } catch (err) {
      setImportResult({ error: err instanceof Error ? err.message : 'That file could not be imported.' });
    } finally {
      setImporting(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      await downloadCollection(state);
    } catch (err) {
      setImportResult({ error: err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Flashcards</h1>
          <div className="sub">
            {state.flashcards.length} card{state.flashcards.length === 1 ? '' : 's'} in {state.decks.length} deck
            {state.decks.length === 1 ? '' : 's'} · {totals.review + totals.learning} due · {totals.newCount} new today
          </div>
        </div>
        <div className="btn-group">
          <button type="button" className="btn small primary" onClick={() => setAdding({ deckId: deck?.id })}>
            + Add
          </button>
          <ActionMenu
            label="Import and export"
            items={[
              { label: importing ? 'Importing…' : 'Import Anki package (.colpkg / .apkg)', onClick: () => fileRef.current?.click() },
              { label: exporting ? 'Exporting…' : 'Export everything (.colpkg)', onClick: () => void runExport() },
            ]}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".colpkg,.apkg,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void runImport(file);
            }}
          />
        </div>
      </div>

      <div className="segmented fc-tabs" role="tablist">
        {(
          [
            ['decks', 'Decks'],
            ['browse', 'Browse'],
            ['stats', 'Stats'],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={route.view === v || (v === 'decks' && route.view === 'deck')}
            onClick={() => go(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {importing && <Callout>Reading the package… large collections can take a little while.</Callout>}
      {importResult && 'error' in importResult && <Callout tone="risk">{importResult.error}</Callout>}
      {importResult && !('error' in importResult) && (
        <Callout tone="ok">
          Imported <strong>{importResult.cards}</strong> card{importResult.cards === 1 ? '' : 's'} into{' '}
          {importResult.decks} deck{importResult.decks === 1 ? '' : 's'}, with {importResult.reviews} review
          {importResult.reviews === 1 ? '' : 's'} and {importResult.media} image{importResult.media === 1 ? '' : 's'}.
          {importResult.skipped > 0 && ` ${importResult.skipped} already here were skipped.`}
          {importResult.notes.map((n) => (
            <div key={n} className="tiny" style={{ marginTop: 4 }}>
              {n}
            </div>
          ))}
        </Callout>
      )}

      <div key={route.view} className="fc-view">
        {route.view === 'browse' && <CardBrowser initialDeckId={route.deck} />}
        {route.view === 'stats' && <FlashcardStats deckId={route.deck} />}

        {route.view === 'deck' && deck && (
          <DeckOverview
            deck={deck}
            counts={counts.get(deck.id)!}
            onStudy={() => go('study', deck.id)}
            onAdd={() => setAdding({ deckId: deck.id })}
            onBrowse={() => go('browse', deck.id)}
            onStats={() => go('stats', deck.id)}
            onOptions={() => setOptionsFor(deck)}
            onReset={() => resetDeck(deck)}
            onDelete={() => {
              const n = state.flashcards.filter((c) => c.deckId === deck.id).length;
              if (window.confirm(`Delete "${deck.name}" and its ${n} card${n === 1 ? '' : 's'}? This cannot be undone.`)) {
                dispatch({ type: 'fc/deck/delete', id: deck.id });
                go('decks');
              }
            }}
          />
        )}

        {(route.view === 'decks' || (route.view === 'deck' && !deck)) && (
          <Card
            title="Decks"
            action={
              state.decks.length > 0 && totals.newCount + totals.learning + totals.review > 0 ? (
                <button type="button" className="btn small" onClick={() => go('study', 'all')}>
                  Study all
                </button>
              ) : undefined
            }
          >
            {state.decks.length === 0 ? (
              <Empty>
                No decks yet. Create one below, add a card (a deck is made for you), or import an Anki <code>.colpkg</code> /{' '}
                <code>.apkg</code> from the menu above.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="deck-table">
                  <thead>
                    <tr>
                      <th>Deck</th>
                      <th className="num">New</th>
                      <th className="num">Learn</th>
                      <th className="num">Due</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {state.decks.map((d) => {
                      const c = counts.get(d.id)!;
                      return (
                        <tr key={d.id} className="deck-row" onClick={() => go('deck', d.id)}>
                          <td>
                            <strong>{d.name}</strong>
                            <div className="tiny faint">
                              {c.total} card{c.total === 1 ? '' : 's'}
                              {c.suspended > 0 ? ` · ${c.suspended} suspended` : ''}
                            </div>
                          </td>
                          <td className={`num mono count-new${c.newCount ? '' : ' zero'}`}>{c.newCount}</td>
                          <td className={`num mono count-learn${c.learning ? '' : ' zero'}`}>{c.learning}</td>
                          <td className={`num mono count-review${c.review ? '' : ' zero'}`}>{c.review}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <ActionMenu
                              label={`${d.name} actions`}
                              items={[
                                { label: 'Study now', onClick: () => go('study', d.id) },
                                { label: 'Add cards', onClick: () => setAdding({ deckId: d.id }) },
                                { label: 'Browse', onClick: () => go('browse', d.id) },
                                { label: 'Options', onClick: () => setOptionsFor(d) },
                                ...(c.total > 0 ? [{ label: 'Reset progress', onClick: () => resetDeck(d), danger: true }] : []),
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <form
              className="row new-deck"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newDeck.trim()) return;
                dispatch({ type: 'fc/deck/add', name: newDeck });
                setNewDeck('');
              }}
            >
              <input type="text" value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder="New deck name" aria-label="New deck name" />
              <button type="submit" className="btn small" disabled={!newDeck.trim()}>
                Create deck
              </button>
            </form>
          </Card>
        )}
      </div>

      {adding && <CardEditorModal defaultDeckId={adding.deckId} onClose={() => setAdding(null)} />}
      {optionsFor && <DeckOptionsModal deck={optionsFor} onClose={() => setOptionsFor(null)} />}
    </>
  );
}

function DeckOverview({
  deck,
  counts,
  onStudy,
  onAdd,
  onBrowse,
  onStats,
  onOptions,
  onReset,
  onDelete,
}: {
  deck: Deck;
  counts: ReturnType<typeof deckCounts>;
  onStudy: () => void;
  onAdd: () => void;
  onBrowse: () => void;
  onStats: () => void;
  onOptions: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const nothing = counts.newCount + counts.learning + counts.review === 0;
  return (
    <Card>
      <div className="deck-overview">
        <h2>{deck.name}</h2>
        {deck.description && <p className="small muted">{deck.description}</p>}
        <div className="overview-counts">
          <div>
            <span className="count-new mono">{counts.newCount}</span>
            <span className="tiny muted">New</span>
          </div>
          <div>
            <span className="count-learn mono">{counts.learning}</span>
            <span className="tiny muted">Learning</span>
          </div>
          <div>
            <span className="count-review mono">{counts.review}</span>
            <span className="tiny muted">To review</span>
          </div>
        </div>
        {nothing ? (
          <p className="small muted">
            {counts.total === 0 ? 'This deck is empty. Add some cards.' : 'Congratulations! You have finished this deck for now.'}
          </p>
        ) : (
          <button type="button" className="btn primary study-now" onClick={onStudy}>
            Study now
          </button>
        )}
        <div className="btn-group overview-actions">
          <button type="button" className="btn small" onClick={onAdd}>
            Add cards
          </button>
          <button type="button" className="btn small" onClick={onBrowse}>
            Browse
          </button>
          <button type="button" className="btn small" onClick={onStats}>
            Stats
          </button>
          <button type="button" className="btn small" onClick={onOptions}>
            Options
          </button>
          {counts.total > 0 && (
            <button type="button" className="btn small danger" onClick={onReset}>
              Reset progress
            </button>
          )}
          <button type="button" className="btn small danger" onClick={onDelete}>
            Delete deck
          </button>
        </div>
      </div>
    </Card>
  );
}

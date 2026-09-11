import { useMemo, useState } from 'react';
import { ERROR_TYPE_LABELS, SECTIONS, SECTION_LABELS } from '../config/catConfig';
import { addDays, formatDate } from '../domain/date';
import type { ErrorEntry, ErrorType, SectionKey } from '../domain/types';
import { errorCountsByType, errorsDueForReview } from '../engine/derive';
import { useStore } from '../state/store';
import { HBarList } from '../ui/charts';
import { Callout, Card, Empty, Field, Modal, Stat, StatGrid, Tag } from '../ui/components';

export function Errors() {
  const { state, dispatch, today } = useStore();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'open' | 'due' | 'all'>('open');
  const [sectionFilter, setSectionFilter] = useState<SectionKey | 'all'>('all');

  const due = errorsDueForReview(state, today);
  const counts = errorCountsByType(state);

  const visible = useMemo(() => {
    let list = [...state.errors].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (filter === 'open') list = list.filter((e) => !e.resolved);
    if (filter === 'due') list = list.filter((e) => due.some((d) => d.id === e.id));
    if (sectionFilter !== 'all') list = list.filter((e) => e.section === sectionFilter);
    return list;
  }, [state.errors, filter, sectionFilter, due]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Error log</h1>
          <div className="sub">Repeated error types are the cheapest percentile available.</div>
        </div>
        <button type="button" className="btn small primary" onClick={() => setAdding(true)}>
          + Log error
        </button>
      </div>

      <Card title="Overview">
        <StatGrid>
          <Stat label="Total logged" value={state.errors.length} />
          <Stat label="Unresolved" value={state.errors.filter((e) => !e.resolved).length} />
          <Stat label="Due for review" value={due.length} sub="revisit date reached" />
          <Stat label="Most common" value={counts[0] ? ERROR_TYPE_LABELS[counts[0].type as ErrorType] : '—'} sub={counts[0] ? `${counts[0].count} times` : ''} />
        </StatGrid>
        {counts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="section-label">Error category distribution</div>
            <HBarList
              items={counts.slice(0, 8).map((c) => ({
                label: ERROR_TYPE_LABELS[c.type as ErrorType] ?? c.type,
                value: c.count,
                tone: 'warn' as const,
              }))}
            />
          </div>
        )}
      </Card>

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="choice-row">
          {(['open', 'due', 'all'] as const).map((f) => (
            <button key={f} type="button" className="choice" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'open' ? 'Unresolved' : f === 'due' ? 'Due for review' : 'All'}
            </button>
          ))}
        </div>
        <div className="choice-row">
          <button type="button" className="choice" aria-pressed={sectionFilter === 'all'} onClick={() => setSectionFilter('all')}>
            All sections
          </button>
          {SECTIONS.map((s) => (
            <button key={s} type="button" className="choice" aria-pressed={sectionFilter === s} onClick={() => setSectionFilter(s)}>
              {SECTION_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty>
          Nothing here. Log every incorrect question with its error type — the planner uses this to decide what you
          study next.
        </Empty>
      ) : (
        visible.map((e) => (
          <Card
            key={e.id}
            title={
              <div className="card-title-row">
                <h3>{e.question || 'Untitled question'}</h3>
                <Tag tone={e.resolved ? 'ok' : 'warn'}>{e.resolved ? 'Resolved' : 'Open'}</Tag>
              </div>
            }
            subtitle={`${SECTION_LABELS[e.section]} · ${ERROR_TYPE_LABELS[e.errorType]} · ${formatDate(e.date, { withYear: true })}`}
          >
            {e.explanation && (
              <p className="small">
                <strong>What went wrong:</strong> {e.explanation}
              </p>
            )}
            {e.correctedApproach && (
              <p className="small">
                <strong>Corrected approach:</strong> {e.correctedApproach}
              </p>
            )}
            {e.revisitDate && (
              <p className="tiny muted">
                Revisit on {formatDate(e.revisitDate, { withYear: true })}
                {e.revisitDate <= today && !e.resolved ? ' — due now' : ''}
              </p>
            )}
            <div className="btn-group" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  dispatch({
                    type: 'error/update',
                    id: e.id,
                    patch: { resolved: !e.resolved, resolvedAt: e.resolved ? undefined : new Date().toISOString() },
                  })
                }
              >
                {e.resolved ? 'Reopen' : 'Mark resolved'}
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: 'error/update', id: e.id, patch: { revisitDate: addDays(today, 7) } })}
              >
                Revisit in 7 days
              </button>
              <button type="button" className="btn small danger" onClick={() => dispatch({ type: 'error/delete', id: e.id })}>
                Delete
              </button>
            </div>
          </Card>
        ))
      )}

      {adding && <ErrorModal onClose={() => setAdding(false)} />}
    </>
  );
}

function ErrorModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, today } = useStore();
  const [entry, setEntry] = useState<Omit<ErrorEntry, 'id' | 'createdAt' | 'updatedAt'>>({
    date: today,
    section: 'QA',
    topicId: undefined,
    question: '',
    errorType: 'concept-gap',
    explanation: '',
    correctedApproach: '',
    revisitDate: addDays(today, 7),
    resolved: false,
  });

  return (
    <Modal
      title="Log an error"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn primary"
            disabled={!entry.question.trim()}
            onClick={() => {
              dispatch({ type: 'error/add', entry });
              onClose();
            }}
          >
            Save
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field label="Question reference" htmlFor="eq" hint="Enough to find it again: source, set, question number, or a one-line description.">
        <input id="eq" type="text" value={entry.question} onChange={(e) => setEntry({ ...entry, question: e.target.value })} />
      </Field>
      <div className="inline-fields-2">
        <Field label="Date" htmlFor="edate">
          <input id="edate" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
        </Field>
        <Field label="Section" htmlFor="esec">
          <select id="esec" value={entry.section} onChange={(e) => setEntry({ ...entry, section: e.target.value as SectionKey })}>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="inline-fields-2">
        <Field label="Topic" htmlFor="etopic">
          <select id="etopic" value={entry.topicId ?? ''} onChange={(e) => setEntry({ ...entry, topicId: e.target.value || undefined })}>
            <option value="">No specific topic</option>
            {state.topics
              .filter((t) => t.section === entry.section)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Error type" htmlFor="etype">
          <select id="etype" value={entry.errorType} onChange={(e) => setEntry({ ...entry, errorType: e.target.value as ErrorType })}>
            {Object.entries(ERROR_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Mock (optional)" htmlFor="emock">
        <select id="emock" value={entry.mockId ?? ''} onChange={(e) => setEntry({ ...entry, mockId: e.target.value || undefined })}>
          <option value="">Not from a mock</option>
          {state.mocks.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.provider} · {m.date}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What went wrong" htmlFor="eexp">
        <textarea id="eexp" value={entry.explanation} onChange={(e) => setEntry({ ...entry, explanation: e.target.value })} />
      </Field>
      <Field label="Corrected approach" htmlFor="ecorr" hint="One line you could apply cold, next time.">
        <textarea id="ecorr" value={entry.correctedApproach} onChange={(e) => setEntry({ ...entry, correctedApproach: e.target.value })} />
      </Field>
      <Field label="Revisit date" htmlFor="erev">
        <input id="erev" type="date" value={entry.revisitDate ?? ''} onChange={(e) => setEntry({ ...entry, revisitDate: e.target.value })} />
      </Field>
      <Callout>
        Error history is a direct input to the planner: repeated types raise the priority of the matching topics and
        generate error-review tasks.
      </Callout>
    </Modal>
  );
}

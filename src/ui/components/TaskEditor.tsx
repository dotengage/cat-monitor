import { useState } from 'react';
import { SECTIONS, SECTION_LABELS, TASK_TYPE_LABELS } from '../../config/catConfig';
import { addDays, formatDate, shortDayName, startOfWeek } from '../../domain/date';
import type { EnergyLevel, Importance, ISODate, SectionKey, Task, TaskType } from '../../domain/types';
import { useStore } from '../../state/store';
import { Callout, Field, Modal } from './index';

/**
 * One editor for both writing a task and changing one later.
 *
 * The generated plan is a starting point, not a cage: anything you write is
 * marked as yours, which means regenerating a week leaves it alone, and every
 * field stays editable afterwards.
 */
export function TaskEditorModal({
  task,
  defaultDate,
  onClose,
}: {
  /** Present when editing an existing task. */
  task?: Task;
  defaultDate?: ISODate | null;
  onClose: () => void;
}) {
  const { dispatch, state, today } = useStore();
  const editing = Boolean(task);

  const [title, setTitle] = useState(task?.title ?? '');
  const [detail, setDetail] = useState(task?.detail ?? '');
  const [date, setDate] = useState<ISODate | ''>(task ? (task.date ?? '') : (defaultDate ?? today));
  const [estimate, setEstimate] = useState(String(task?.estimateMin ?? 45));
  const [type, setType] = useState<TaskType>(task?.type ?? 'practice');
  const [section, setSection] = useState<SectionKey | ''>(task?.section ?? '');
  const [importance, setImportance] = useState<Importance>(task?.importance ?? 'important');
  const [energy, setEnergy] = useState(String(task?.energyRequired ?? 3));
  const [repeatDays, setRepeatDays] = useState(1);

  const canSave = title.trim().length > 0;

  const save = () => {
    const shared = {
      title: title.trim(),
      detail: detail.trim() || undefined,
      type,
      section: section || undefined,
      estimateMin: Number(estimate) || 30,
      importance,
      energyRequired: (Number(energy) || 3) as EnergyLevel,
      impact: importance === 'critical' ? 5 : importance === 'important' ? 3 : 2,
    };

    if (task) {
      const nextDate = date === '' ? null : date;
      dispatch({
        type: 'task/update',
        id: task.id,
        patch: {
          ...shared,
          date: nextDate,
          weekStart: nextDate ? startOfWeek(nextDate, state.settings.weekStartsOn) : null,
          // Moving a missed task back onto a day makes it live again.
          ...(task.status === 'missed' && nextDate ? { status: 'planned' as const, needsDecision: false } : {}),
        },
      });
      onClose();
      return;
    }

    // Repeating creates one real task per day rather than a recurring rule, so
    // each day can be completed, missed or rescheduled independently.
    for (let i = 0; i < Math.max(1, repeatDays); i += 1) {
      const taskDate = date === '' ? null : addDays(date, i);
      dispatch({
        type: 'task/add',
        task: {
          ...shared,
          date: taskDate,
          weekStart: taskDate ? startOfWeek(taskDate, state.settings.weekStartsOn) : null,
          goalId: state.goals.find((g) => g.isPrimary)?.id,
          dependsOn: [],
          status: 'planned',
          locked: false,
          postponeCount: 0,
          origin: 'user',
        },
      });
    }
    onClose();
  };

  return (
    <Modal
      title={editing ? 'Edit task' : 'Add your own task'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" disabled={!canSave} onClick={save}>
            {editing ? 'Save changes' : repeatDays > 1 ? `Add to ${repeatDays} days` : 'Add task'}
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          {editing && task && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                dispatch({ type: 'task/remove', id: task.id, reason: 'Removed while editing.' });
                onClose();
              }}
            >
              Delete task
            </button>
          )}
        </>
      }
    >
      <Field
        label="What exactly will you do?"
        htmlFor="ttitle"
        hint="Specific and measurable beats vague: 'Solve 12 ratio questions and review every wrong answer', not 'Study QA'."
      >
        <input
          id="ttitle"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Solve 12 ratio questions and review every wrong answer"
        />
      </Field>
      <Field label="Notes (optional)" htmlFor="tdetail">
        <textarea id="tdetail" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>

      <div className="inline-fields-2">
        <Field
          label="Day"
          htmlFor="tdate"
          hint={date ? `${shortDayName(date)} ${formatDate(date)}` : 'Backlog: no day committed'}
        >
          <input id="tdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="How long? (minutes)" htmlFor="test">
          <input id="test" type="number" min={5} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        </Field>
      </div>

      <div className="inline-fields-2">
        <Field label="Type" htmlFor="ttype">
          <select id="ttype" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Section" htmlFor="tsection">
          <select id="tsection" value={section} onChange={(e) => setSection(e.target.value as SectionKey | '')}>
            <option value="">None</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="inline-fields-2">
        <Field label="Importance" htmlFor="timp" hint="Decides what happens to it if you miss it.">
          <select id="timp" value={importance} onChange={(e) => setImportance(e.target.value as Importance)}>
            <option value="critical">Critical — protect it</option>
            <option value="important">Important — can be shortened</option>
            <option value="optional">Optional — drop it if the week is full</option>
          </select>
        </Field>
        <Field label="Energy needed (1-5)" htmlFor="tenergy">
          <input id="tenergy" type="number" min={1} max={5} value={energy} onChange={(e) => setEnergy(e.target.value)} />
        </Field>
      </div>

      {!editing && (
        <Field label="Repeat" htmlFor="trepeat" hint="Plan ahead: adds the same task to consecutive days, each tracked separately.">
          <select
            id="trepeat"
            value={repeatDays}
            onChange={(e) => setRepeatDays(Number(e.target.value))}
            disabled={date === ''}
          >
            <option value={1}>Just this day</option>
            <option value={3}>Next 3 days</option>
            <option value={5}>Next 5 days</option>
            <option value={7}>Every day for a week</option>
            <option value={14}>Every day for 2 weeks</option>
          </select>
        </Field>
      )}

      {editing ? (
        <Callout>
          Changing the day moves the task; clearing it sends the task to the backlog. Editing a missed task puts it back
          on the plan.
        </Callout>
      ) : (
        <Callout>
          Tasks you add are yours: regenerating a week never deletes them, and if you miss one the planner asks you what
          to do with it rather than deciding on its own.
        </Callout>
      )}
    </Modal>
  );
}

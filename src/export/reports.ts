/**
 * Report builders.
 *
 * Kept as pure functions of `AppState` and a date, exactly like the planning
 * engine, so the contents of a report can be asserted in tests rather than
 * eyeballed in a PDF viewer.
 */
import { ERROR_TYPE_LABELS, SECTIONS, SECTION_LABELS } from '../config/catConfig';
import { addDays, formatDate, formatHours, formatLongDate } from '../domain/date';
import type { AppState, ErrorType, ISODate, SectionKey } from '../domain/types';
import { errorCountsByType, fullMocks, overallPercentileHistory, sectionStats, sortedMocks, topicStats } from '../engine/derive';
import { buildEstimationModel } from '../engine/estimation';
import { calculateHabitStats, studyLogRows, studyTotals } from '../engine/habits';
import { calculateForecast, describeContradiction, formatBand, PATTERN_LABELS, type Forecast } from '../engine/forecast';
import { calculateFeasibility } from '../engine/workload';
import { PdfDoc } from './pdf';

function stamp(state: AppState, today: ISODate): string {
  return `${state.profile.targetPercentile}+ percentile target  -  exam ${formatLongDate(state.profile.examDate)}  -  generated ${formatDate(today, { withYear: true })}`;
}


/* ------------------------------------------------------------------ */
/* Forecast blocks, in the guide's output order                        */
/* ------------------------------------------------------------------ */

const r1 = (n: number) => String(Math.round(n * 10) / 10);
const r0 = (n: number) => String(Math.round(n));
const NR = 'not recorded';
const chance = (p: number) => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);
const statusText = (f: Forecast) =>
  f.status === 'UNCONFIRMED' ? 'UNCONFIRMED' : `${f.status.replace('_', ' ')}${f.highVariance ? ' + HIGH VARIANCE' : ''}`;

/** Block 1 only: the short version used where the full analysis would be repetition. */
function writeHeadline(doc: PdfDoc, f: Forecast) {
  const p = f.forecast?.percentile;
  doc.stats([
    {
      label: 'Current level',
      value: f.level ? (f.level.percentile !== undefined ? r1(f.level.percentile) : `${r0(f.level.marks)} marks`) : NR,
    },
    { label: 'Likely exam day', value: p ? r1(p.p50) : NR },
    { label: 'Range (P10-P90)', value: p ? `${r1(p.p10)} to ${r1(p.p90)}` : NR },
    { label: `Chance of ${f.target}`, value: f.forecast?.probability !== undefined ? chance(f.forecast.probability) : NR },
    { label: 'Status', value: statusText(f) },
    { label: 'Evidence', value: `${f.n} mocks, ${f.confidence}` },
  ]);
  for (const line of f.headline) doc.paragraph(line, { size: 9 });
  doc.paragraph(`Next: ${f.recommendedAction}`);
}

function writeForecastBlocks(doc: PdfDoc, f: Forecast) {
  /* 1. Headline */
  doc.heading('1. Headline');
  writeHeadline(doc, f);

  /* 2. What changed */
  doc.heading('2. What changed');
  doc.bullets(f.whatChanged.length > 0 ? f.whatChanged : ['First report: nothing to compare against.']);

  /* 3. Trend */
  doc.heading('3. Trend');
  doc.paragraph(f.trend.summary);
  const marked = f.history.filter((h) => h.marks !== undefined);
  if (marked.length > 0) {
    doc.lineChart(
      marked.map((h) => ({ label: formatDate(h.date), value: h.marks as number })),
      f.curve?.targetMarks !== undefined ? Math.round(f.curve.targetMarks) : undefined,
    );
  }
  if (f.curve) {
    doc.paragraph(
      `One more percentile point near ${f.target} costs about ${r1(f.curve.marksPerPointAtTarget ?? 0)} marks at your level` +
        (f.curve.targetMarks !== undefined ? `; ${f.target} percentile needs roughly ${r0(f.curve.targetMarks)} marks.` : '.') +
        (f.curve.provisional ? ` Mapping provisional (${f.curve.pairs} pairs; a fitted curve needs 5).` : ''),
      { muted: true, size: 9 },
    );
  }

  /* 4. Binding constraint */
  doc.heading('4. Binding constraint');
  if (!f.constraint.established) {
    doc.paragraph(f.constraint.note, { muted: true });
  } else {
    doc.table(
      [
        { header: 'Section', width: 13 },
        { header: 'Var. share', width: 13, align: 'right' },
        { header: 'Ceiling gap', width: 13, align: 'right' },
        { header: 'Floor loss', width: 13, align: 'right' },
        { header: 'Pts/mark', width: 12, align: 'right' },
        { header: 'Gap', width: 36 },
      ],
      f.constraint.top.map((d) => [
        SECTION_LABELS[d.section],
        `${Math.round(d.varianceShare * 100)}%`,
        r1(d.ceilingGap),
        `${r1(d.floorLoss)} (${Math.round(d.floorShare * 100)}%)`,
        d.marginalValue !== undefined ? r1(d.marginalValue) : NR,
        `${d.kind}. ${d.why}`,
      ]),
    );
    doc.paragraph(f.constraint.note, { muted: true, size: 9 });
  }

  /* 5. Clean paper rate */
  doc.heading('5. Clean paper rate');
  if (!f.cleanPaper) {
    doc.paragraph('Needs full mocks with marks for all three sections.', { muted: true });
  } else {
    const c = f.cleanPaper;
    doc.paragraph(
      `${c.count} of ${c.n} full mocks (${Math.round(c.rate * 100)}%) had every section above the floor.` +
        (c.combinedBestMarks !== undefined
          ? ` Section bests together: ${r0(c.combinedBestMarks)} marks${c.combinedBestPercentile !== undefined ? `, about ${r1(c.combinedBestPercentile)} percentile` : ''}.`
          : '') +
        (c.consistencyHeadline ? ' The target is inside your demonstrated range: the headline finding is consistency.' : ''),
    );
    doc.paragraph(c.rule, { muted: true, size: 9 });
  }

  /* 6. Forecast table */
  doc.heading('6. Forecast');
  if (f.scenarios.length === 0) {
    doc.paragraph('No forecast: no full mock with marks yet.', { muted: true });
  } else {
    doc.table(
      [
        { header: 'Scenario', width: 14 },
        { header: 'Percentile', width: 13, align: 'right' },
        { header: 'Marks', width: 10, align: 'right' },
        { header: 'Chance', width: 21 },
        { header: 'What has to hold', width: 42 },
      ],
      f.scenarios.map((sc) => [
        sc.label,
        sc.percentile !== undefined ? r1(sc.percentile) : NR,
        r0(sc.marks),
        sc.chance,
        sc.conditions.join(' '),
      ]),
    );
    if (f.forecast) doc.bullets(f.forecast.notes);
  }

  /* 7. Section cards */
  doc.heading('7. Sections');
  for (const card of f.sections) {
    const level = card.level;
    doc.keyValues([
      [
        SECTION_LABELS[card.section],
        `${card.status.replace('_', ' ')}${level ? `, level ${level.percentile !== undefined ? `${r1(level.percentile)} pctl` : `${r0(level.marks)} marks`}` : ''}`,
      ],
      ['Latest / average of last 5', `${card.latestPercentile ?? NR} / ${card.recentAveragePercentile ?? NR}`],
      ['Trend', card.trend.label === 'INSUFFICIENT' ? 'not established' : card.trend.label.toLowerCase()],
      ['Target attempts', card.attempts.band ? formatBand(card.attempts.band) : NR],
      ['Accuracy floor', card.attempts.accuracyFloor !== undefined ? `${card.attempts.accuracyFloor}%` : NR],
      ...(card.dilr
        ? ([['DILR sets', `${Math.round(card.dilr.conversion * 100)}% converted; expected ${card.dilr.expected.map((e) => r0(e)).join('/')} marks at 0/1/2/3 solved`]] as [string, string][])
        : []),
    ]);
    doc.paragraph(`Action: ${card.action}`, { size: 9 });
    doc.paragraph(`${card.statusRule} ${card.sectional.verdict}`, { muted: true, size: 8 });
  }

  /* 8. Error patterns */
  doc.heading('8. Error patterns');
  if (f.patterns.patterns.length === 0) {
    doc.paragraph(
      f.patterns.mocksWithNotes === 0 ? 'No analysis notes recorded yet.' : 'No recurring patterns found in the notes.',
      { muted: true },
    );
  } else {
    doc.table(
      [
        { header: 'Pattern', width: 40 },
        { header: 'Mocks', width: 15, align: 'right' },
        { header: 'Trend', width: 22 },
        { header: 'Last seen', width: 23 },
      ],
      f.patterns.patterns.map((pt) => [PATTERN_LABELS[pt.tag], String(pt.frequency), pt.trend.toLowerCase(), formatDate(pt.lastSeen, { withYear: true })]),
    );
  }
  for (const c of f.patterns.contradictions) doc.paragraph(`Possible contradiction: ${describeContradiction(c)}`, { size: 9 });

  /* 9. Data quality */
  doc.heading('9. Data quality');
  doc.bullets(f.dataQuality);
}

/* ------------------------------------------------------------------ */
/* Mock report                                                         */
/* ------------------------------------------------------------------ */

export function buildMockReport(state: AppState, today: ISODate): PdfDoc {
  const doc = new PdfDoc('CAT Monitor - Mock report');
  const forecast = calculateForecast(state, today);
  const mocks = sortedMocks(state);
  const full = fullMocks(state);

  doc.title('Mock report', stamp(state, today));

  doc.stats([
    { label: 'Full mocks', value: String(full.length) },
    { label: 'Analysed', value: `${full.filter((m) => m.analysed).length} of ${full.length}` },
    { label: 'Sectionals', value: String(mocks.filter((m) => m.kind === 'sectional').length) },
    { label: 'Latest percentile', value: forecast.latestPercentile !== undefined ? String(forecast.latestPercentile) : NR },
    { label: 'Best percentile', value: forecast.bestPercentile !== undefined ? String(forecast.bestPercentile) : NR },
    {
      label: 'Average (last 5)',
      value: forecast.recentAveragePercentile !== undefined ? `${forecast.recentAveragePercentile} (${forecast.recentAverageCount})` : NR,
    },
  ]);

  writeForecastBlocks(doc, forecast);

  /* ---- Every mock ---- */
  doc.pageBreak();
  doc.title('Mock by mock', `${mocks.length} recorded`);

  if (mocks.length === 0) {
    doc.paragraph('No mocks have been recorded yet.', { muted: true });
  }

  for (const mock of [...mocks].reverse()) {
    doc.heading(`${mock.name || mock.provider}${mock.kind === 'sectional' ? ' (sectional)' : ''}`);
    doc.keyValues([
      ['Date', formatDate(mock.date, { withYear: true })],
      ['Provider', mock.provider],
      ['Analysis', mock.analysed ? 'complete' : 'INCOMPLETE'],
      ...(mock.kind === 'full'
        ? ([
            ['Overall score', mock.overallScore === undefined ? NR : String(mock.overallScore)],
            ['Overall percentile', mock.overallPercentile ? String(mock.overallPercentile) : NR],
          ] as [string, string][])
        : []),
    ]);

    const rows = SECTIONS.filter((s) => mock.sections[s]).map((s) => {
      const sec = mock.sections[s]!;
      const recorded = sec.attempts > 0;
      const acc = recorded ? `${Math.round((sec.correct / sec.attempts) * 100)}%` : NR;
      return [
        SECTION_LABELS[s],
        String(sec.score),
        sec.percentile > 0 ? String(sec.percentile) : NR,
        recorded ? String(sec.attempts) : NR,
        recorded ? String(sec.correct) : NR,
        acc,
      ];
    });
    if (rows.length > 0) {
      doc.table(
        [
          { header: 'Section', width: 24 },
          { header: 'Score', width: 14, align: 'right' },
          { header: 'Percentile', width: 18, align: 'right' },
          { header: 'Attempts', width: 16, align: 'right' },
          { header: 'Correct', width: 14, align: 'right' },
          { header: 'Accuracy', width: 14, align: 'right' },
        ],
        rows,
      );
    }

    if ((mock.dilrSetsAttempted ?? 0) > 0) {
      doc.paragraph(`DILR sets: ${mock.dilrSetsSolved ?? 0} solved of ${mock.dilrSetsAttempted} attempted.`, { size: 9 });
    }
    if (mock.timeNotes) doc.paragraph(`Time management: ${mock.timeNotes}`, { size: 9 });
    if (mock.selectionNotes) doc.paragraph(`Question selection: ${mock.selectionNotes}`, { size: 9 });
    if (mock.mainMistakes) doc.paragraph(`Main mistakes: ${mock.mainMistakes}`, { size: 9 });
    const lessons = mock.lessons.filter(Boolean);
    if (lessons.length > 0) doc.bullets(lessons);
    if (!mock.analysed) {
      doc.paragraph('This mock is unanalysed: its notes are missing from the error-pattern analysis.', {
        muted: true,
        size: 9,
      });
    }
  }

  return doc;
}

/* ------------------------------------------------------------------ */
/* Analytics report                                                    */
/* ------------------------------------------------------------------ */

export function buildAnalyticsReport(state: AppState, today: ISODate): PdfDoc {
  const doc = new PdfDoc('CAT Monitor - Analytics report');
  const feasibility = calculateFeasibility(state, today);
  const workload = feasibility.workload;
  const habits = calculateHabitStats(state, today);

  doc.title('Analytics report', stamp(state, today));

  /* ---- Where things stand ---- */
  doc.heading('Where things stand');
  doc.paragraph(feasibility.headline);
  doc.paragraph(feasibility.reason, { muted: true });
  doc.keyValues(feasibility.inputs.map((i) => [i.label, i.value] as [string, string]));

  /* ---- Workload ---- */
  doc.heading('Remaining workload');
  doc.stats([
    { label: 'Remaining', value: formatHours(workload.remainingMin, 0) },
    { label: 'Required / week', value: formatHours(workload.requiredPerWeekMin, 1) },
    { label: 'Realistic / week', value: formatHours(workload.realisticPerWeekMin, 1) },
    { label: 'Weeks left', value: String(workload.weeksRemaining) },
    { label: 'Health', value: workload.health.replace('_', ' ').toLowerCase() },
    { label: 'Actual / week', value: workload.actualPerWeekMin ? formatHours(workload.actualPerWeekMin, 1) : 'n/a' },
  ]);
  doc.table(
    [
      { header: 'Component', width: 70 },
      { header: 'Hours', width: 30, align: 'right' },
    ],
    workload.breakdown.map((b) => [b.label, formatHours(b.min, 1)]),
  );
  doc.paragraph(feasibility.safety.message, { muted: true, size: 9 });

  /* ---- Plan vs reality ---- */
  const weeks: { start: ISODate; planned: number; actual: number; tasks: number; done: number }[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    const start = addDays(today, -i * 7);
    const end = addDays(start, 6);
    const tasks = state.tasks.filter((t) => t.date !== null && t.date >= start && t.date <= end && t.status !== 'removed');
    const record = state.capacityRecords.find((r) => r.weekStart === start);
    if (tasks.length === 0 && !record) continue;
    const doneMin = tasks
      .filter((t) => t.status === 'done' || t.status === 'partial')
      .reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0);
    weeks.push({
      start,
      planned: tasks.reduce((a, t) => a + t.estimateMin, 0),
      actual: record?.actualMin ?? doneMin,
      tasks: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
    });
  }

  if (weeks.length > 0) {
    doc.heading('Plan vs reality');
    doc.table(
      [
        { header: 'Week of', width: 24 },
        { header: 'Planned', width: 16, align: 'right' },
        { header: 'Actual', width: 16, align: 'right' },
        { header: 'Tasks', width: 14, align: 'right' },
        { header: 'Done', width: 14, align: 'right' },
        { header: 'Rate', width: 16, align: 'right' },
      ],
      weeks.map((w) => [
        formatDate(w.start, { withYear: true }),
        formatHours(w.planned, 1),
        formatHours(w.actual, 1),
        String(w.tasks),
        String(w.done),
        `${w.tasks > 0 ? Math.round((w.done / w.tasks) * 100) : 0}%`,
      ]),
    );
  }

  /* ---- Forecast ---- */
  const forecast = calculateForecast(state, today);
  doc.heading('Exam-day forecast');
  writeHeadline(doc, forecast);
  if (forecast.scenarios.length > 0) {
    doc.table(
      [
        { header: 'Scenario', width: 16 },
        { header: 'Percentile', width: 16, align: 'right' },
        { header: 'Marks', width: 12, align: 'right' },
        { header: 'Chance', width: 56 },
      ],
      forecast.scenarios.map((sc) => [sc.label, sc.percentile !== undefined ? r1(sc.percentile) : NR, r0(sc.marks), sc.chance]),
    );
  }
  doc.paragraph('The full analysis, block by block, is in the mock report.', { muted: true, size: 9 });

  /* ---- Mock trends ---- */
  const history = overallPercentileHistory(state);
  if (history.length > 0) {
    doc.heading('Recorded overall percentile');
    doc.lineChart(
      history.map((h) => ({ label: formatDate(h.date), value: h.percentile })),
      state.profile.targetPercentile,
    );
  }

  // Not first-to-latest change: two points say nothing about direction. The
  // trend is the marks regression with its interval, from the forecast.
  doc.heading('Sections');
  doc.table(
    [
      { header: 'Section', width: 16 },
      { header: 'Latest', width: 15, align: 'right' },
      { header: 'Avg last 5', width: 17, align: 'right' },
      { header: 'Trend (marks)', width: 20 },
      { header: 'Status', width: 18 },
      { header: 'Mocks', width: 14, align: 'right' },
    ],
    forecast.sections.map((c) => [
      SECTION_LABELS[c.section],
      c.latestPercentile !== undefined ? String(c.latestPercentile) : NR,
      c.recentAveragePercentile !== undefined ? String(c.recentAveragePercentile) : NR,
      c.trend.label === 'INSUFFICIENT' ? 'not established' : c.trend.label.toLowerCase(),
      c.status.replace('_', ' ').toLowerCase(),
      String(c.trend.n),
    ]),
  );

  /* ---- Study volume ---- */
  doc.pageBreak();
  doc.title('Study, habits and errors', stamp(state, today));

  const rows = studyLogRows(state, addDays(today, -29), today);
  const totals = studyTotals(rows);
  doc.heading('Study log (last 30 days)');
  doc.stats([
    { label: 'Total logged', value: formatHours(totals.totalMin, 1) },
    { label: 'Days logged', value: String(totals.daysLogged) },
    { label: 'Avg per active day', value: formatHours(totals.averageMinPerLoggedDay, 1) },
  ]);
  if (totals.totalMin > 0) {
    doc.bars(
      SECTIONS.map((s) => ({
        label: SECTION_LABELS[s],
        value: Math.round((totals.bySection[s] / 60) * 10) / 10,
        caption: `${Math.round((totals.bySection[s] / Math.max(1, totals.totalMin)) * 100)}%`,
      })),
      'h',
    );
  }

  const logged = rows.filter((r) => r.totalMin > 0);
  if (logged.length > 0) {
    doc.table(
      [
        { header: 'Date', width: 18 },
        { header: 'VARC', width: 24 },
        { header: 'DILR', width: 24 },
        { header: 'QA', width: 24 },
        { header: 'Total', width: 12, align: 'right' },
      ],
      logged
        .slice(0, 30)
        .map((r) => [
          formatDate(r.date),
          cell(r.sections.VARC),
          cell(r.sections.DILR),
          cell(r.sections.QA),
          formatHours(r.totalMin, 1),
        ]),
    );
  }

  /* ---- Habits ---- */
  doc.heading('Consistency');
  doc.stats([
    { label: 'Current streak', value: `${habits.currentStreak} days` },
    { label: 'Best streak', value: `${habits.bestStreak} days` },
    { label: 'Consistency', value: `${Math.round(habits.consistency * 100)}%` },
  ]);

  /* ---- Topic accuracy ---- */
  const topics = topicStats(state).filter((t) => t.attempted >= 5);
  if (topics.length > 0) {
    doc.heading('Accuracy by topic');
    doc.table(
      [
        { header: 'Topic', width: 42 },
        { header: 'Section', width: 14 },
        { header: 'Attempted', width: 16, align: 'right' },
        { header: 'Accuracy', width: 14, align: 'right' },
        { header: 'Errors', width: 14, align: 'right' },
      ],
      [...topics]
        .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
        .slice(0, 25)
        .map((t) => [
          t.name,
          SECTION_LABELS[t.section],
          String(t.attempted),
          `${Math.round((t.accuracy ?? 0) * 100)}%`,
          String(t.errorCount),
        ]),
    );
  }

  /* ---- Section practice ---- */
  const stats = sectionStats(state);
  doc.heading('Practice volume by section');
  doc.table(
    [
      { header: 'Section', width: 26 },
      { header: 'Sessions', width: 15, align: 'right' },
      { header: 'Questions', width: 15, align: 'right' },
      { header: 'Accuracy', width: 15, align: 'right' },
      { header: 'Hours', width: 15, align: 'right' },
      { header: 'DILR sets', width: 14, align: 'right' },
    ],
    SECTIONS.map((s) => [
      SECTION_LABELS[s],
      String(stats[s].sessions),
      String(stats[s].attempted),
      stats[s].accuracy === null ? '-' : `${Math.round(stats[s].accuracy! * 100)}%`,
      formatHours(stats[s].timeMin, 1),
      s === 'DILR' ? `${stats[s].setsSolved}/${stats[s].setsAttempted}` : '-',
    ]),
  );

  /* ---- Errors ---- */
  const errorCounts = errorCountsByType(state);
  if (errorCounts.length > 0) {
    doc.heading('Error categories');
    doc.bars(
      errorCounts.slice(0, 10).map((e) => ({
        label: ERROR_TYPE_LABELS[e.type as ErrorType] ?? e.type,
        value: e.count,
      })),
    );
    doc.paragraph(
      `${state.errors.filter((e) => !e.resolved).length} of ${state.errors.length} logged errors are still unresolved.`,
      { muted: true, size: 9 },
    );
  }

  /* ---- Estimation drift ---- */
  const model = buildEstimationModel(state, state.settings.planning);
  if (model.size > 0) {
    doc.heading('Estimated vs actual duration');
    doc.table(
      [
        { header: 'Task type', width: 40 },
        { header: 'Samples', width: 15, align: 'right' },
        { header: 'Avg est', width: 15, align: 'right' },
        { header: 'Avg actual', width: 15, align: 'right' },
        { header: 'Factor', width: 15, align: 'right' },
      ],
      [...model.values()]
        .sort((a, b) => b.samples - a.samples)
        .map((s) => [
          s.key === '*' ? 'All tasks' : s.key.replace('|', ' - '),
          String(s.samples),
          `${s.meanEstimateMin}m`,
          `${s.meanActualMin}m`,
          s.factor.toFixed(2),
        ]),
    );
    doc.paragraph('A factor above 1.00 means sessions run longer than planned; future estimates are nudged upward.', {
      muted: true,
      size: 9,
    });
  }

  return doc;
}

function cell(entry: { minutes: number; topics: string }): string {
  if (entry.minutes === 0 && !entry.topics) return '-';
  const hours = formatHours(entry.minutes, 1);
  return entry.topics ? `${hours}  ${entry.topics}` : hours;
}

/** Filename that sorts chronologically and says what it is. */
export function reportFilename(kind: 'mock' | 'analytics', today: ISODate): string {
  return `cat-monitor-${kind}-report-${today}.pdf`;
}

export function sectionLabel(section: SectionKey): string {
  return SECTION_LABELS[section];
}

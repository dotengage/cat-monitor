import { useCallback, useEffect, useRef, useState } from 'react';
import { buildRecogniser, decodeImage, pixelsAt, readingWidths } from '../../import/glyphs';
import { isDarkPage, recognise } from '../../import/ocr';
import { buildScoreTable, combineTables, describeTable, type ScoreTable } from '../../import/scoreTable';

type Phase = { kind: 'idle' } | { kind: 'reading' } | { kind: 'done'; table: ScoreTable } | { kind: 'failed'; message: string };

/**
 * Reads a result table out of a screenshot.
 *
 * Paste is the first-class way in, because that is how a screenshot actually
 * arrives - Win+Shift+S, then Ctrl+V - and saving it to a file first only to
 * pick it back out of a dialog is work the computer should be doing. Dropping
 * and choosing a file both work too.
 *
 * Nothing is uploaded. The recognition runs here, in this tab, on pixels that
 * never leave the device.
 */
export function ScreenshotImport({ onRead }: { onRead: (table: ScoreTable) => number }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [filled, setFilled] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const read = useCallback(
    async (file: File | Blob) => {
      setPhase({ kind: 'reading' });
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      setPreview(URL.createObjectURL(file));

      try {
        const image = await decodeImage(file);
        const recogniser = buildRecogniser();
        const readings: (ScoreTable | null)[] = [];
        const widths = readingWidths(image.naturalWidth);
        // Every size with normal strokes; and for light text on a dark page,
        // which renders heavier, the first size again with thin ones.
        const passes = widths.map((width) => ({ width, thin: false }));
        if (isDarkPage(pixelsAt(image, Math.min(600, image.naturalWidth)))) passes.push({ width: widths[0], thin: true });
        for (const { width, thin } of passes) {
          // Yield between readings so the "Reading" state paints and the tab stays responsive.
          await new Promise((resolve) => setTimeout(resolve, 0));
          const { lines, numericLines } = recognise(pixelsAt(image, width), recogniser, { thin });
          readings.push(buildScoreTable(lines, numericLines));
        }
        const table = combineTables(readings);

        if (!table) {
          setPhase({
            kind: 'failed',
            message:
              'No scores were found in that image. Include the headings or labels (Score, Percentile, Attempted, Correct and so on) in the screenshot, along with the figures.',
          });
          return;
        }
        setFilled(onRead(table));
        setPhase({ kind: 'done', table });
      } catch (err) {
        setPhase({ kind: 'failed', message: err instanceof Error ? err.message : 'That image could not be read.' });
      }
    },
    [onRead],
  );

  // Paste anywhere while the form is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void read(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [read]);

  return (
    <div className="field">
      <div
        className={`shot-drop${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file?.type.startsWith('image/')) void read(file);
        }}
      >
        {preview && <img className="shot-thumb" src={preview} alt="" />}
        <div className="shot-body">
          <strong>Fill this in from a screenshot</strong>
          <span className="tiny muted">
            Press <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste one, drop it here, or choose a file. It is read on this device.
          </span>
          <div className="btn-group">
            <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
              Choose image
            </button>
            {phase.kind === 'reading' && <span className="tiny muted">Reading…</span>}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void read(file);
            e.target.value = '';
          }}
        />
      </div>

      {phase.kind === 'done' && (
        <div
          className={`callout ${phase.table.warnings.length > 0 || phase.table.confidence < 0.72 ? 'warn' : 'ok'}`}
          style={{ marginTop: 10 }}
        >
          <strong>
            Filled {filled} field{filled === 1 ? '' : 's'}.
          </strong>{' '}
          {describeTable(phase.table)}
          {phase.table.warnings.length > 0 && (
            <ul className="bullets tiny" style={{ marginTop: 6 }}>
              {phase.table.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {phase.table.warnings.length === 0 && phase.table.confidence < 0.72 && (
            <div className="tiny" style={{ marginTop: 6 }}>
              Some characters were hard to make out, so check the numbers below carefully.
            </div>
          )}
        </div>
      )}

      {phase.kind === 'failed' && (
        <div className="callout warn" style={{ marginTop: 10 }}>
          {phase.message}
        </div>
      )}
    </div>
  );
}

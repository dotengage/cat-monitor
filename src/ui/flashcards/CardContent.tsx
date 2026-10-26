import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { sanitize } from '../../flashcards/html';
import { MEDIA_EVENT, refreshMedia, resolveMedia, storeMedia } from '../../flashcards/media';

/** Until images resolve, an <img> with no src renders nothing rather than a broken icon. */
const withoutSources = (html: string) => html.replace(/<img src="media:([^"]+)"/g, '<img data-media="$1"');

/**
 * Renders card HTML. It is sanitised again here even though it was sanitised
 * on the way in: rendering is where an unsafe string would do harm, so this
 * is where the guarantee is enforced, whatever path the content took.
 */
export function CardContent({ html, className }: { html: string; className?: string }) {
  const safe = sanitize(html);
  const [resolved, setResolved] = useState(() => withoutSources(safe));
  const [arrivals, setArrivals] = useState(0);

  useEffect(() => {
    let alive = true;
    void resolveMedia(safe).then((out) => {
      if (alive) setResolved(out);
    });
    return () => {
      alive = false;
    };
  }, [safe, arrivals]);

  // An image this card uses may arrive by sync while it is on screen.
  useEffect(() => {
    const onArrival = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!safe.includes(`media:${id}"`)) return;
      refreshMedia(id);
      setArrivals((n) => n + 1);
    };
    window.addEventListener(MEDIA_EVENT, onArrival);
    return () => window.removeEventListener(MEDIA_EVENT, onArrival);
  }, [safe]);

  return <div className={`card-content${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: resolved }} />;
}

/* ------------------------------------------------------------------ */
/* Rich field                                                          */
/* ------------------------------------------------------------------ */

/**
 * Converts what is in the editor back into stored card HTML: displayed
 * images point at temporary object URLs, so they are mapped back to their
 * `media:` ids, and anything else is sanitised.
 */
function serialise(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img) => {
    const id = img.getAttribute('data-media');
    if (!id) {
      img.remove();
      return;
    }
    for (const attr of [...img.attributes]) img.removeAttribute(attr.name);
    img.setAttribute('src', `media:${id}`);
  });
  clone.querySelectorAll('.missing-media').forEach((node) => {
    const id = node.getAttribute('data-media');
    const img = document.createElement('img');
    if (id) img.setAttribute('src', `media:${id}`);
    node.replaceWith(img);
  });
  return sanitize(clone.innerHTML);
}

function insertHtml(html: string) {
  // execCommand is deprecated but remains the only way to insert at the caret
  // that keeps the browser's own undo history intact.
  if (!document.execCommand('insertHTML', false, html)) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const fragment = range.createContextualFragment(html);
    range.insertNode(fragment);
    selection.collapseToEnd();
  }
}

export async function imagesToHtml(files: File[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    const id = await storeMedia(file, file.name && file.name !== 'image.png' ? file.name : undefined);
    parts.push(await resolveMedia(`<img src="media:${id}">`));
  }
  return parts.join('');
}

const TOOLS: { command: string; label: string; title: string }[] = [
  { command: 'bold', label: 'B', title: 'Bold (Ctrl+B)' },
  { command: 'italic', label: 'I', title: 'Italic (Ctrl+I)' },
  { command: 'underline', label: 'U', title: 'Underline (Ctrl+U)' },
  { command: 'superscript', label: 'x²', title: 'Superscript' },
  { command: 'subscript', label: 'x₂', title: 'Subscript' },
  { command: 'insertUnorderedList', label: '•', title: 'Bulleted list' },
  { command: 'insertOrderedList', label: '1.', title: 'Numbered list' },
  { command: 'removeFormat', label: '⌫', title: 'Clear formatting' },
];

/**
 * An editable card side, behaving like a field in Anki's editor: type,
 * format, and paste a screenshot straight in with Ctrl+V.
 */
export function RichField({
  label,
  value,
  onChange,
  autoFocus,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emitted = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Only replace the editor's contents when the value changed from outside -
  // clearing after Add, or opening another card - never while typing, which
  // would throw the caret to the start.
  //
  // The DOM is updated synchronously, with images swapped in afterwards. An
  // asynchronous reset left a window in which a blur could read the old text
  // back out of the editor and write it into the next card.
  useEffect(() => {
    if (value === emitted.current || !ref.current) return;
    const safe = sanitize(value);
    ref.current.innerHTML = withoutSources(safe);
    emitted.current = value;
    if (!safe.includes('src="media:')) return;
    let alive = true;
    void resolveMedia(safe).then((html) => {
      if (alive && ref.current && emitted.current === value) ref.current.innerHTML = html;
    });
    return () => {
      alive = false;
    };
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Reports only real changes. Blur fires on every focus move, including the
  // one Add causes, and must not re-send what the field already said.
  const emit = () => {
    if (!ref.current) return;
    const html = serialise(ref.current);
    if (html === emitted.current) return;
    emitted.current = html;
    onChange(html);
  };

  const addImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    ref.current?.focus();
    const selection = window.getSelection();
    const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setBusy(true);
    try {
      const html = await imagesToHtml(images);
      ref.current?.focus();
      if (saved && ref.current?.contains(saved.commonAncestorContainer)) {
        selection?.removeAllRanges();
        selection?.addRange(saved);
      }
      insertHtml(html);
      emit();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rich-field${dragging ? ' dragging' : ''}`}>
      <div className="rich-head">
        <span className="rich-label">{label}</span>
        <div className="rich-tools" role="toolbar" aria-label={`${label} formatting`}>
          {TOOLS.map((t) => (
            <button
              key={t.command}
              type="button"
              title={t.title}
              aria-label={t.title}
              onMouseDown={(e) => {
                e.preventDefault();
                ref.current?.focus();
                document.execCommand(t.command);
                emit();
              }}
            >
              {t.label}
            </button>
          ))}
          <button type="button" title="Attach an image" aria-label="Attach an image" onClick={() => fileRef.current?.click()}>
            📎
          </button>
        </div>
      </div>
      <div
        ref={ref}
        className="rich-input card-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder ?? 'Type, or paste a screenshot with Ctrl+V'}
        data-autofocus={autoFocus ? '' : undefined}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e: ReactKeyboardEvent) => {
          // Ctrl+Enter belongs to the form, not to a new line.
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') e.preventDefault();
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault();
            void addImages(files);
            return;
          }
          const html = e.clipboardData.getData('text/html');
          e.preventDefault();
          if (html) insertHtml(sanitize(html));
          else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          emit();
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          const files = [...e.dataTransfer.files];
          if (files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault();
            void addImages(files);
          }
        }}
      />
      {busy && <div className="tiny muted rich-busy">Adding image…</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addImages([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

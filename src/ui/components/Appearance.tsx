import { useRef, useState } from 'react';
import { BRAND_IMAGE_PX, THEMES, type ThemeName } from '../../config/themes';
import type { Brand } from '../../domain/types';
import { Field } from './index';

/* ------------------------------------------------------------------ */
/* Theme picker                                                        */
/* ------------------------------------------------------------------ */

const GROUP_ORDER = ['Base', 'Pastel', 'Dark'] as const;

/**
 * Swatches rather than a dropdown: a theme is chosen by how it looks, so the
 * control should show that. Each dot carries its own name underneath - colour
 * is never the only way to tell the options apart.
 */
export function ThemePicker({ value, onChange }: { value: ThemeName; onChange: (theme: ThemeName) => void }) {
  return (
    <div className="theme-groups">
      {GROUP_ORDER.map((group) => (
        <div key={group}>
          <div className="section-label">{group}</div>
          <div className="theme-row" role="radiogroup" aria-label={`${group} themes`}>
            {THEMES.filter((t) => t.group === group).map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={value === t.id}
                className="theme-swatch"
                onClick={() => onChange(t.id)}
                title={t.label}
              >
                <span
                  className="dot"
                  aria-hidden="true"
                  style={{ background: t.swatch[0], borderColor: t.swatch[1] }}
                >
                  <span style={{ background: t.swatch[1] }} />
                </span>
                <span className="name">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brand editor                                                        */
/* ------------------------------------------------------------------ */

/**
 * Squares an uploaded image to a small PNG.
 *
 * The mark lives in application state, which is what gets synced and backed
 * up, so a 4 MB photo would end up travelling with every write. Centre-cropped
 * to a square and redrawn at 128px it costs a few kilobytes instead.
 */
async function toSquareDataUrl(file: File): Promise<string> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });

  const side = Math.min(source.naturalWidth, source.naturalHeight);
  if (side === 0) throw new Error('That image has no dimensions.');

  const canvas = document.createElement('canvas');
  canvas.width = BRAND_IMAGE_PX;
  canvas.height = BRAND_IMAGE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give us a canvas to resize with.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    source,
    (source.naturalWidth - side) / 2,
    (source.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    BRAND_IMAGE_PX,
    BRAND_IMAGE_PX,
  );
  return canvas.toDataURL('image/png');
}

export function BrandEditor({ brand, onChange }: { brand: Brand; onChange: (patch: Partial<Brand>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      onChange({ image: await toSquareDataUrl(file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be used.');
    }
  }

  return (
    <>
      <div className="brand-editor">
        <div className="brand-preview">
          {brand.image ? (
            <img src={brand.image} alt="" />
          ) : (
            <span aria-hidden="true">{brand.glyph || 'C'}</span>
          )}
        </div>
        <div className="brand-fields">
          <Field label="Name" htmlFor="brand-name">
            <input
              id="brand-name"
              type="text"
              maxLength={28}
              value={brand.name}
              placeholder="CAT Monitor"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
          <Field
            label="Letter or emoji"
            htmlFor="brand-glyph"
            hint="Shown when no image is uploaded."
          >
            <input
              id="brand-glyph"
              type="text"
              maxLength={2}
              value={brand.glyph}
              placeholder="C"
              onChange={(e) => onChange({ glyph: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="btn-group">
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
          {brand.image ? 'Replace image' : 'Upload image'}
        </button>
        {brand.image && (
          <button type="button" className="btn small subtle" onClick={() => onChange({ image: undefined })}>
            Remove image
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="small" style={{ color: 'var(--risk)', marginTop: 8 }}>
          {error}
        </p>
      )}
      <p className="tiny muted" style={{ marginTop: 8 }}>
        The image is cropped square and stored at {BRAND_IMAGE_PX}px inside your own data, so it syncs with everything
        else and never leaves your devices.
      </p>
    </>
  );
}

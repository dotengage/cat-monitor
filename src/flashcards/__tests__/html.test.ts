/**
 * Sanitiser tests, mostly written as attacks.
 *
 * An imported Anki deck is someone else's HTML. These pin down that nothing
 * executable, nothing that fetches a remote URL and no event handler can
 * survive the trip into a card, however the input is malformed.
 */
import { describe, expect, it } from 'vitest';
import { decodeEntities, isBlank, mediaRefs, sanitize, textToHtml, toPlainText } from '../html';

describe('sanitize: what must never survive', () => {
  it.each([
    ['<script>alert(1)</script>hi', 'hi'],
    ['<ScRiPt>alert(1)</sCrIpT>hi', 'hi'],
    ['<svg><script>alert(1)</script></svg>ok', 'ok'],
    ['<style>body{display:none}</style>ok', 'ok'],
    ['<iframe src="https://evil.example"></iframe>ok', 'ok'],
    ['<img src=x onerror=alert(1)>', ''],
    ['<img src="https://tracker.example/p.gif">', ''],
    ['<img src="javascript:alert(1)">', ''],
    ['<img src="media:../../etc/passwd">', ''],
    ['<a href="javascript:alert(1)">click</a>', 'click'],
    ['<div onclick="alert(1)" style="background:url(x)">x</div>', '<div>x</div>'],
    ['<form><input value="x"></form>after', 'after'],
  ])('%s', (input, expected) => {
    expect(sanitize(input)).toBe(expected);
  });

  it('keeps no attribute it does not know', () => {
    expect(sanitize('<b class="x" id="y" data-z="1">bold</b>')).toBe('<b>bold</b>');
  });

  it('cannot be tricked by a tag split across another tag', () => {
    const out = sanitize('<scr<script>ipt>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
  });

  it('respects quotes when finding the end of a tag', () => {
    expect(sanitize('<img src="media:a.png" alt="x>y">')).toBe('<img src="media:a.png" alt="x&gt;y">');
  });

  it('drops everything after an unterminated comment', () => {
    expect(sanitize('ok<!-- <script>alert(1)</script>')).toBe('ok');
  });
});

describe('sanitize: what must survive', () => {
  it('keeps the formatting Anki cards use', () => {
    const html = '<b>Bold</b> <i>it</i> <u>u</u><br><ul><li>one</li></ul><sub>2</sub><sup>3</sup>';
    expect(sanitize(html)).toBe(html);
  });

  it('keeps images from the media store', () => {
    expect(sanitize('<img src="media:3f2a.png">')).toBe('<img src="media:3f2a.png">');
  });

  it('keeps table spans but nothing else on cells', () => {
    expect(sanitize('<table><tr><td colspan="2" onclick="x">a</td></tr></table>')).toBe(
      '<table><tr><td colspan="2">a</td></tr></table>',
    );
  });

  it('closes tags left open and ignores stray closers', () => {
    expect(sanitize('<b>bold')).toBe('<b>bold</b>');
    expect(sanitize('</div>text')).toBe('text');
  });

  it('escapes text so maths survives as text', () => {
    expect(sanitize('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
  });

  it('unwraps unknown tags but keeps their text', () => {
    expect(sanitize('<font color="red">red</font>')).toBe('red');
  });
});

describe('content helpers', () => {
  it('decodes common and numeric entities', () => {
    expect(decodeEntities('&lt;x&gt; &amp; &#8730;2 &#x3c0;')).toBe('<x> & √2 π');
  });

  it('reads plain text with images marked', () => {
    expect(toPlainText('<b>Find</b> x<br><img src="media:a.png">')).toBe('Find x [image]');
  });

  it('treats an image-only side as content', () => {
    expect(isBlank('<img src="media:a.png">')).toBe(false);
    expect(isBlank('<br><div> </div>')).toBe(true);
  });

  it('lists the media a side refers to', () => {
    expect(mediaRefs('<img src="media:a.png"> and <img src="media:b.jpg">')).toEqual(['a.png', 'b.jpg']);
  });

  it('turns typed text into safe HTML', () => {
    expect(textToHtml('x < 3\nnext')).toBe('x &lt; 3<br>next');
  });
});

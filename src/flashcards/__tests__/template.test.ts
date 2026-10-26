import { describe, expect, it } from 'vitest';
import { answerOnly, clozeNumbers, renderCloze, renderTemplate } from '../colpkg/template';

const BASIC_A = '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}';

describe('renderTemplate', () => {
  it('renders a Basic card', () => {
    const fields = { Front: 'Q', Back: 'A' };
    expect(renderTemplate('{{Front}}', fields, 0, 'question')).toBe('Q');
    expect(answerOnly(renderTemplate(BASIC_A, fields, 0, 'answer'))).toBe('A');
  });

  it('renders the reverse card of a reversed note', () => {
    const fields = { Front: 'Ephemeral', Back: 'Short-lived' };
    expect(renderTemplate('{{Back}}', fields, 1, 'question')).toBe('Short-lived');
    expect(answerOnly(renderTemplate('{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}', fields, 1, 'answer'))).toBe('Ephemeral');
  });

  it('honours conditional sections', () => {
    const t = '{{#Add Reverse}}{{Back}}{{/Add Reverse}}';
    expect(renderTemplate(t, { Back: 'B', 'Add Reverse': 'y' }, 1, 'question')).toBe('B');
    expect(renderTemplate(t, { Back: 'B', 'Add Reverse': '' }, 1, 'question')).toBe('');
    expect(renderTemplate('{{^Hint}}none{{/Hint}}', { Hint: '' }, 0, 'question')).toBe('none');
  });

  it('treats a field holding only markup as empty', () => {
    expect(renderTemplate('{{#Extra}}x{{/Extra}}', { Extra: '<br>' }, 0, 'question')).toBe('');
  });

  it('shows a type-in answer only on the answer side', () => {
    const fields = { Front: 'Q', Back: 'A' };
    expect(renderTemplate('{{Front}}\n\n{{type:Back}}', fields, 0, 'question').trim()).toBe('Q');
    expect(answerOnly(renderTemplate('{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}', fields, 0, 'answer'))).toBe('A');
  });

  it('strips markup with the text filter', () => {
    expect(renderTemplate('{{text:Front}}', { Front: '<b>bold</b>' }, 0, 'question')).toBe('bold');
  });

  it('drops unknown fields rather than printing template syntax', () => {
    expect(renderTemplate('{{Missing}}x', {}, 0, 'question')).toBe('x');
  });
});

describe('cloze', () => {
  const text = 'The capital of {{c1::France}} is {{c2::Paris::city}}';

  it('hides only the active deletion on the question', () => {
    expect(renderCloze(text, 1, 'question')).toBe('The capital of <b>[...]</b> is Paris');
    expect(renderCloze(text, 2, 'question')).toBe('The capital of France is <b>[city]</b>');
  });

  it('reveals it on the answer', () => {
    expect(renderCloze(text, 1, 'answer')).toBe('The capital of <b>France</b> is Paris');
  });

  it('lists the deletions a note produces cards for', () => {
    expect(clozeNumbers(text)).toEqual([1, 2]);
  });

  it('renders through the cloze filter by card ordinal', () => {
    expect(renderTemplate('{{cloze:Text}}', { Text: text }, 1, 'question')).toContain('[city]');
  });
});

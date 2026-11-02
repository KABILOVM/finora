import { describe, expect, it } from 'vitest';
import { collectTags, type KnownTag } from './knownTags';
import { MAX_TAG_CHIPS, noteTagChips, pickTag, tagIsOn, tagPartial } from './noteTags';
import { NOTE_MAX } from './txForm';

/** Известные метки: Самарканд (3), работа (2), семья (1). */
const known: KnownTag[] = collectTags(['a #Самарканд', 'b #Самарканд', 'c #Самарканд #работа', 'd #работа', 'e #семья']);
const labels = (items: readonly KnownTag[]) => items.map((t) => t.label);
const tag = (key: string): KnownTag => known.find((t) => t.key === key)!;

describe('tagPartial: недописанная метка в конце заметки', () => {
  it('«#» и начало метки в конце (перед ними пробел или начало строки)', () => {
    expect(tagPartial('кофе #')).toEqual({ start: 5, text: '' });
    expect(tagPartial('кофе #са')).toEqual({ start: 5, text: 'са' });
    expect(tagPartial('#са')).toEqual({ start: 0, text: 'са' });
    expect(tagPartial('кофе #Самарканд')).toEqual({ start: 5, text: 'Самарканд' });
  });

  it('нет, если в конце не метка: обычный текст, пробел после метки, «#» внутри слова', () => {
    expect(tagPartial('')).toBeNull();
    expect(tagPartial('кофе')).toBeNull();
    expect(tagPartial('кофе #Самарканд ')).toBeNull();
    expect(tagPartial('a#b')).toBeNull();
    expect(tagPartial('кофе #са ночью')).toBeNull();
  });
});

describe('noteTagChips: что показать под заметкой', () => {
  it('нет «недописанной» метки — переключатели со всеми метками, чаще встречающиеся первыми', () => {
    const chips = noteTagChips(known, 'кофе');
    expect(chips.mode).toBe('toggle');
    expect(labels(chips.items)).toEqual(['Самарканд', 'работа', 'семья']);
  });

  it('набрано «#» и начало — подсказки только на это начало (без учёта регистра и «ё»)', () => {
    expect(noteTagChips(known, 'кофе #').mode).toBe('complete');
    expect(labels(noteTagChips(known, 'кофе #').items)).toEqual(['Самарканд', 'работа', 'семья']);
    expect(labels(noteTagChips(known, 'кофе #СА').items)).toEqual(['Самарканд']);
    expect(labels(noteTagChips(known, 'кофе #с').items)).toEqual(['Самарканд', 'семья']);
    expect(noteTagChips(known, 'кофе #яя').items).toEqual([]); // такого начала нет
  });

  it('целая известная метка в конце — не «недописанное»: чипы остаются переключателями (можно добавить вторую)', () => {
    const chips = noteTagChips(known, 'кофе #Самарканд');
    expect(chips.mode).toBe('toggle');
    expect(labels(chips.items)).toEqual(['Самарканд', 'работа', 'семья']);
  });

  it('нет известных меток — пусто; длинный список обрезается', () => {
    expect(noteTagChips([], 'кофе').items).toEqual([]);
    const many = collectTags(Array.from({ length: 30 }, (_, i) => `x #метка${String(i).padStart(2, '0')}`));
    expect(noteTagChips(many, '').items).toHaveLength(MAX_TAG_CHIPS);
  });
});

describe('pickTag: что станет с заметкой', () => {
  it('переключатель: метки нет — добавляется в конец (пустая заметка — просто метка); есть — убирается', () => {
    expect(pickTag('кофе', tag('самарканд'), 'toggle')).toBe('кофе #Самарканд');
    expect(pickTag('', tag('самарканд'), 'toggle')).toBe('#Самарканд');
    expect(pickTag('кофе #Самарканд', tag('самарканд'), 'toggle')).toBe('кофе');
    expect(pickTag('кофе #самарканд #работа', tag('самарканд'), 'toggle')).toBe('кофе #работа');
    expect(pickTag('кофе #Самарканд', tag('работа'), 'toggle')).toBe('кофе #Самарканд #работа');
  });

  it('подсказка: недописанное начало заменяется меткой целиком', () => {
    expect(pickTag('кофе #са', tag('самарканд'), 'complete')).toBe('кофе #Самарканд');
    expect(pickTag('кофе #', tag('работа'), 'complete')).toBe('кофе #работа');
    expect(pickTag('#с', tag('семья'), 'complete')).toBe('#семья');
  });

  it('метка вставляется так, как её писали раньше (с «_»)', () => {
    const trip = collectTags(['гостиница #Поездка_в_Самарканд'])[0]!;
    expect(pickTag('кофе', trip, 'toggle')).toBe('кофе #Поездка_в_Самарканд');
  });

  it('не помещается в предел заметки — заметка прежняя', () => {
    const long = 'я'.repeat(NOTE_MAX - 5);
    expect(pickTag(long, tag('самарканд'), 'toggle')).toBe(long);
    expect(pickTag(`${long.slice(0, NOTE_MAX - 8)} #са`, tag('самарканд'), 'complete')).toBe(`${long.slice(0, NOTE_MAX - 8)} #са`);
  });

  it('tagIsOn: метка уже в заметке (без учёта регистра)', () => {
    expect(tagIsOn('кофе #самарканд', tag('самарканд'))).toBe(true);
    expect(tagIsOn('кофе', tag('самарканд'))).toBe(false);
    expect(tagIsOn('кофе #Самарканд2', tag('самарканд'))).toBe(false);
  });
});

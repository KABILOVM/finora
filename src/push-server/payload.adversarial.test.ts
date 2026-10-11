// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPayload, cleanName, debtRemainingMinor, fitPayload, utf8Bytes, type DebtLite, type DebtTxLite } from '../../supabase/functions/send-reminders/index';
import { computeDebtState } from '../domain/debts';
import type { Debt, Transaction, Wallet } from '../domain/types';

/* ---------------------------------------------------------------------------------------------
 * Нападение на текст уведомления и расчёт остатка долга случайными данными (сид фиксирован — прогон повторяем).
 * ------------------------------------------------------------------------------------------- */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const PIECES = [
  'а', 'Я', 'ё', 'Щ', 'x', 'Z', '0', ' ', '  ', '\n', '\t', '\u0000', '\u0085', '‎', '‮', ' ', '"', '\\', '<', '>', '&', '(', ')', '…',
  '😀', '👨‍👩‍👧‍👦', '🇹🇯', '🏳️‍🌈', '👍🏽', 'é', 'é', 'กำ', '한', '漢', '‍', '️', '﻿', '​',
];

function junk(r: () => number, max: number): string {
  let s = '';
  const n = Math.floor(r() * max);
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(r() * PIECES.length)];
  return s;
}

const BAD_CHARS = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]');
const wellFormed = (s: string): boolean => (typeof s.isWellFormed === 'function' ? s.isWellFormed() : !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s));

describe('текст уведомления: случайные названия с эмодзи, склейками, управляющими знаками', () => {
  it('2000 случайных сообщений: ≤ 300 знаков, JSON ≤ 2000 байт, строка целая (без одиночных суррогатов), без управляющих знаков', () => {
    const r = rng(12345);
    for (let i = 0; i < 2000; i++) {
      const payments = Array.from({ length: Math.floor(r() * 30) }, () => ({ note: junk(r, 120), overdue: r() < 0.5 }));
      const debts = Array.from({ length: Math.floor(r() * 30) }, () => ({ counterparty: junk(r, 120) }));
      const p = buildPayload({ payments, debts, daily: r() < 0.3 }, r() < 0.7);
      if (p === null) {
        expect(payments.length + debts.length).toBe(0);
        continue;
      }
      const json = JSON.stringify(p);
      expect(p.body.length, `i=${i}`).toBeLessThanOrEqual(300);
      expect(utf8Bytes(json), `i=${i}`).toBeLessThanOrEqual(2000);
      expect(wellFormed(p.body), `i=${i} body=${JSON.stringify(p.body)}`).toBe(true);
      // разбор «как на телефоне»: туда и обратно без потерь
      expect(JSON.parse(json)).toEqual(p);
      // ни одной управляющей и «разворачивающей» строку метки в тексте
      expect(BAD_CHARS.test(p.body), `i=${i}`).toBe(false);
    }
  });

  it('show_details = false: ни одно название из данных не попадает в текст, даже если оно состоит из «подходящих» слов', () => {
    const r = rng(777);
    for (let i = 0; i < 500; i++) {
      const secret = `СЕКРЕТ${Math.floor(r() * 1e6)}`;
      const p = buildPayload({ payments: [{ note: secret, overdue: false }], debts: [{ counterparty: secret }], daily: false }, false);
      expect(JSON.stringify(p)).not.toContain('СЕКРЕТ');
    }
  });

  it('обрезка идёт по целым знакам: усечённое начало совпадает с началом исходного текста (по знакам, как их видит человек)', () => {
    const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
    const g = (s: string) => Array.from(seg.segment(s), (x) => x.segment);
    const r = rng(99);
    for (let i = 0; i < 500; i++) {
      const body = junk(r, 800) + 'я';
      const out = fitPayload({ title: 'Finora', body, url: '/', tag: 't' }).body;
      if (out === body) continue;
      expect(out.endsWith('…') || out === '').toBe(true);
      const head = g(out.slice(0, -1));
      const orig = g(body);
      // допускаем срезанные пробелы справа у начала
      for (let k = 0; k < head.length; k++) expect(head[k], `i=${i} k=${k}`).toBe(orig[k]);
    }
  });

  it('название из одних управляющих и невидимых знаков заменяется запасным словом, а не пустотой в скобках', () => {
    expect(cleanName('\u0000\u0001\n\t ‮', 'Платёж')).toBe('Платёж');
    expect(cleanName('', 'Долг')).toBe('Долг');
    expect(cleanName(undefined, 'Долг')).toBe('Долг');
    expect(cleanName(12345, 'Долг')).toBe('Долг');
  });
});

describe('остаток долга на сервере совпадает с остатком в приложении (случайные операции)', () => {
  const CUR = ['TJS', 'USD', 'RUB'];
  it('3000 случайных долгов: «остаток > 0» одинаков с computeDebtState из приложения', () => {
    const r = rng(2026);
    let positive = 0;
    for (let i = 0; i < 3000; i++) {
      const wallets: Array<Pick<Wallet, 'id' | 'currency'>> = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => ({ id: `w${k}`, currency: CUR[Math.floor(r() * CUR.length)]! }));
      const debt: DebtLite = { id: 'd1', direction: r() < 0.5 ? 'lent' : 'borrowed', counterparty: 'X', principalMinor: 1 + Math.floor(r() * 5000), currency: CUR[Math.floor(r() * CUR.length)]!, dueOn: '2026-10-10' };
      const txs: DebtTxLite[] = [];
      const appTxs: Array<Pick<Transaction, 'id' | 'kind' | 'walletId' | 'amountMinor' | 'occurredOn' | 'createdAt' | 'deletedAt' | 'debtId'>> = [];
      const n = Math.floor(r() * 6);
      for (let k = 0; k < n; k++) {
        const w = r() < 0.1 ? 'ghost' : wallets[Math.floor(r() * wallets.length)]!.id;
        const kind = (['income', 'expense', 'transfer'] as const)[Math.floor(r() * 3)]!;
        const amountMinor = r() < 0.05 ? 0 : 1 + Math.floor(r() * 3000);
        const deleted = r() < 0.2;
        const other = r() < 0.1;
        appTxs.push({ id: `t${k}`, kind, walletId: w, amountMinor, occurredOn: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', deletedAt: deleted ? '2026-10-02T00:00:00Z' : null, debtId: other ? 'd2' : 'd1' });
        if (!deleted) txs.push({ debtId: other ? 'd2' : 'd1', kind, walletId: w, amountMinor });
      }
      const server = debtRemainingMinor(debt, txs, new Map(wallets.map((w) => [w.id, w.currency])));
      const app = computeDebtState(debt as unknown as Pick<Debt, 'id' | 'direction' | 'principalMinor' | 'currency'>, appTxs, wallets);
      expect(server, `i=${i}`).toBe(BigInt(app.remainingMinor));
      if (server > 0n) positive++;
    }
    expect(positive).toBeGreaterThan(300);
  });
});

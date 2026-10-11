import { describe, expect, it } from 'vitest';
import type { LocalRow, Transaction, Wallet } from '@/domain/types';
import { mergeRemoteRow, sameContent, snapshotRow, type MergeContext } from '@/db/syncMerge';
import { makeTransaction, makeWallet } from '../sync/factories';

/**
 * Трёхстороннее слияние одной строки (db/syncMerge.ts): база — версия сервера, поверх которой сделаны наши правки (dirtyBase),
 * «наша» — локальная неотправленная, «чужая» — пришедшая с сервера. Группы полей — MERGE_GROUPS (sync/tables.ts).
 */

const T = (n: number): string => new Date(Date.UTC(2026, 9, 10, 12, 0, 0, n)).toISOString();
const FRESH = T(900); // метка, которую «выдают часы» слитой правке

const ctx = (over: Partial<MergeContext> = {}): MergeContext => ({ table: 'wallets', stamp: () => FRESH, deviceId: 'dev-me', ...over });
const txCtx = (over: Partial<MergeContext> = {}): MergeContext => ctx({ table: 'transactions', ...over });

const BASE = makeWallet({ id: 'w-1', name: 'База', color: '#111111', icon: 'a', sortOrder: 1, clientUpdatedAt: T(10), deviceId: 'dev-x' });

/** Локальная неотправленная строка поверх базы. */
const dirtyLocal = (over: Partial<Wallet>, seq: number | null = 5, base: Wallet | null = BASE): LocalRow<Wallet> => ({
  ...BASE,
  clientUpdatedAt: T(20),
  deviceId: 'dev-me',
  ...over,
  dirty: 1,
  serverSeq: seq,
  syncError: null,
  ...(base ? { dirtyBase: snapshotRow('wallets', base) } : {}),
});

/** Строка с сервера. */
const remote = (over: Partial<Wallet>): Wallet => ({ ...BASE, clientUpdatedAt: T(30), deviceId: 'dev-other', ...over });

describe('слияние по группам полей (есть база)', () => {
  it('правки РАЗНЫХ групп складываются: имя — наше, цвет — чужой; строка остаётся «грязной» с новой меткой этого устройства', () => {
    const local = dirtyLocal({ name: 'Наше имя' });
    const r = mergeRemoteRow(local, remote({ color: '#222222' }), 9, ctx());
    expect(r.outcome).toBe('merged');
    expect(r.row).toMatchObject({
      name: 'Наше имя',
      color: '#222222',
      clientUpdatedAt: FRESH,
      deviceId: 'dev-me',
      dirty: 1,
      serverSeq: 9,
      syncError: null,
      createdAt: BASE.createdAt,
    });
    // база сдвигается на серверную версию: следующее слияние сравнивает с ней
    expect(r.row?.dirtyBase).toEqual(snapshotRow('wallets', remote({ color: '#222222' })));
  });

  it('группы из нескольких полей неделимы: «цвет + значок» берутся вместе у одной стороны', () => {
    const local = dirtyLocal({ color: '#aaaaaa' }); // наша метка T(20)
    const r = mergeRemoteRow(local, remote({ icon: 'z', clientUpdatedAt: T(30) }), 9, ctx());
    // обе стороны правили группу «цвет + значок»: чужая новее — берём группу целиком, цвет не остаётся нашим
    expect(r.outcome).toBe('lostLocal');
    expect(r.row).toMatchObject({ color: BASE.color, icon: 'z', dirty: 0, serverSeq: 9 });
  });

  it('одну группу изменили обе стороны, наша метка новее: остаётся наша правка как есть (метка не меняется), база сдвигается', () => {
    const local = dirtyLocal({ name: 'Наше', clientUpdatedAt: T(50) });
    const r = mergeRemoteRow(local, remote({ name: 'Чужое', clientUpdatedAt: T(30) }), 9, ctx());
    expect(r.outcome).toBe('keptLocal');
    expect(r.row).toMatchObject({ name: 'Наше', clientUpdatedAt: T(50), deviceId: 'dev-me', dirty: 1, serverSeq: 9 });
    expect(r.row?.dirtyBase).toEqual(snapshotRow('wallets', remote({ name: 'Чужое', clientUpdatedAt: T(30) })));
  });

  it('одну группу изменили обе стороны, чужая метка новее: чужая версия принимается, наша правка проиграла', () => {
    const local = dirtyLocal({ name: 'Наше', clientUpdatedAt: T(20) });
    const r = mergeRemoteRow(local, remote({ name: 'Чужое', clientUpdatedAt: T(30) }), 9, ctx());
    expect(r.outcome).toBe('lostLocal');
    expect(r.row).toMatchObject({ name: 'Чужое', clientUpdatedAt: T(30), deviceId: 'dev-other', dirty: 0, serverSeq: 9, syncError: null });
    expect(r.row).not.toHaveProperty('dirtyBase');
  });

  it('обе стороны независимо поставили одно и то же значение: строка становится «чистой», ничего отправлять не нужно', () => {
    const local = dirtyLocal({ name: 'Одинаково', clientUpdatedAt: T(50) });
    const r = mergeRemoteRow(local, remote({ name: 'Одинаково', clientUpdatedAt: T(30) }), 9, ctx());
    expect(r.outcome).toBe('replaced');
    expect(r.row).toMatchObject({ name: 'Одинаково', dirty: 0, serverSeq: 9 });
  });

  it('эхо нашей же правки (сервер принял, ответ потерялся): строка становится «чистой» с серверной версией', () => {
    const local = dirtyLocal({ name: 'Моя правка', clientUpdatedAt: T(20) }, 5);
    const echo = remote({ name: 'Моя правка', clientUpdatedAt: T(20), deviceId: 'dev-me' });
    const r = mergeRemoteRow(local, echo, 9, ctx());
    expect(r.outcome).toBe('replaced');
    expect(r.row).toMatchObject({ dirty: 0, serverSeq: 9, name: 'Моя правка' });
  });

  it('удаление — отдельная группа: чужое удаление и наша правка имени сохраняются обе', () => {
    const local = dirtyLocal({ name: 'Новое имя' });
    const r = mergeRemoteRow(local, remote({ deletedAt: T(30) }), 9, ctx());
    expect(r.outcome).toBe('merged');
    expect(r.row).toMatchObject({ name: 'Новое имя', deletedAt: T(30), dirty: 1 });
  });

  it('метка нашей правки меньше серверной, а чужая правка ничего не изменила в содержимом: правка отправится с НОВОЙ меткой (иначе сервер молча её проигнорирует)', () => {
    const local = dirtyLocal({ name: 'Наше', clientUpdatedAt: T(20) });
    // чужая версия новее по метке, но по содержимому равна базе (например, пересохранили без изменений)
    const r = mergeRemoteRow(local, remote({ clientUpdatedAt: T(30) }), 9, ctx());
    expect(r.outcome).toBe('merged');
    expect(r.row).toMatchObject({ name: 'Наше', clientUpdatedAt: FRESH, deviceId: 'dev-me', dirty: 1 });
    expect(FRESH > T(30)).toBe(true);
  });

  it('версия сервера не новее уже учтённой: ничего не пишем (повтор страницы)', () => {
    const local = dirtyLocal({ name: 'Наше' }, 9);
    for (const seq of [9, 4]) {
      const r = mergeRemoteRow(local, remote({ color: '#222222' }), seq, ctx());
      expect(r).toEqual({ outcome: 'keptLocal', row: null });
    }
  });

  it('строка ещё не синхронизировалась (serverSeq null), но база есть: сливается как обычно', () => {
    const local = dirtyLocal({ name: 'Наше' }, null);
    const r = mergeRemoteRow(local, remote({ color: '#222222' }), 9, ctx());
    expect(r.outcome).toBe('merged');
    expect(r.row).toMatchObject({ name: 'Наше', color: '#222222', serverSeq: 9 });
  });

  it('карантин: слитая строка с новым содержимым получает новую попытку (syncError снят), а оставленная как есть — нет', () => {
    const quarantined = { ...dirtyLocal({ name: 'Наше' }), syncError: 'Сервер не принял запись' };
    expect(mergeRemoteRow(quarantined, remote({ color: '#222222' }), 9, ctx()).row?.syncError).toBeNull();
    const kept = { ...dirtyLocal({ name: 'Наше', clientUpdatedAt: T(50) }), syncError: 'Сервер не принял запись' };
    expect(mergeRemoteRow(kept, remote({ name: 'Чужое', clientUpdatedAt: T(30) }), 9, ctx()).row?.syncError).toBe('Сервер не принял запись');
  });

  it('часы не выдали метку (исключение): откат к слиянию целой строкой — побеждает большая метка', () => {
    const boom = ctx({
      stamp: () => {
        throw new Error('часы за пределом');
      },
    });
    const local = dirtyLocal({ name: 'Наше' });
    const r = mergeRemoteRow(local, remote({ color: '#222222' }), 9, boom);
    expect(r.outcome).toBe('lostLocal'); // чужая метка новее
    expect(r.row).toMatchObject({ name: BASE.name, color: '#222222', dirty: 0 });
  });
});

describe('слияние операций: связанные поля не расщепляются', () => {
  const baseTx = makeTransaction({ id: 't-1', walletId: 'w-1', amountMinor: 10_000, baseAmountMinor: 10_000, note: 'обед', clientUpdatedAt: T(10), deviceId: 'dev-x' });
  const localTx = (over: Partial<Transaction>): LocalRow<Transaction> => ({
    ...baseTx,
    clientUpdatedAt: T(20),
    deviceId: 'dev-me',
    ...over,
    dirty: 1,
    serverSeq: 5,
    syncError: null,
    dirtyBase: snapshotRow('transactions', baseTx),
  });
  const remoteTx = (over: Partial<Transaction>): Transaction => ({ ...baseTx, clientUpdatedAt: T(30), deviceId: 'dev-other', ...over });

  it('заметка и сумма — разные группы: складываются', () => {
    const r = mergeRemoteRow(localTx({ note: 'ужин' }), remoteTx({ amountMinor: 25_000, baseAmountMinor: 25_000 }), 9, txCtx());
    expect(r.outcome).toBe('merged');
    expect(r.row).toMatchObject({ note: 'ужин', amountMinor: 25_000, baseAmountMinor: 25_000 });
  });

  it('сумма и её снимок в базовой валюте (и курс) идут одной группой: нельзя взять сумму у одного, а снимок у другого', () => {
    // мы поменяли сумму и снимок, чужая сторона — только курс и источник той же суммы: обе тронули одну группу
    const r = mergeRemoteRow(
      localTx({ amountMinor: 20_000, baseAmountMinor: 20_000, clientUpdatedAt: T(50) }),
      remoteTx({ fxRate: 2, fxSource: 'manual', baseAmountMinor: 20_000, clientUpdatedAt: T(30) }),
      9,
      txCtx(),
    );
    // наша метка новее — группа целиком наша, чужой курс не подмешивается к нашей сумме
    expect(r.row).toMatchObject({ amountMinor: 20_000, baseAmountMinor: 20_000, fxRate: 1, fxSource: 'same' });
  });

  it('вид, кошельки, категория и суммы перевода — одна группа: перевод не собирается из кусков', () => {
    const asTransfer = { kind: 'transfer' as const, toWalletId: 'w-2', toAmountMinor: 10_000, categoryId: null, fxRate: null, fxSource: null, baseAmountMinor: 0 };
    const withCategory = { categoryId: 'c-1' };
    const r = mergeRemoteRow(localTx({ ...asTransfer, clientUpdatedAt: T(50) }), remoteTx({ ...withCategory, clientUpdatedAt: T(30) }), 9, txCtx());
    // обе стороны правили группу «что произошло»; наша метка новее — берём её целиком (перевод без категории), а не перевод с чужой категорией
    expect(r.row).toMatchObject({ kind: 'transfer', toWalletId: 'w-2', categoryId: null });
  });
});

describe('без базы или без контекста — прежнее правило «побеждает вся строка с большей меткой»', () => {
  it('нет dirtyBase: чужая новее → проигрыш; наша новее → остаётся, serverSeq сдвигается', () => {
    const lost = mergeRemoteRow(dirtyLocal({ name: 'Наше' }, 5, null), remote({ color: '#222222' }), 9, ctx());
    expect(lost.outcome).toBe('lostLocal');
    expect(lost.row).toMatchObject({ name: BASE.name, color: '#222222', dirty: 0 });
    const kept = mergeRemoteRow(dirtyLocal({ name: 'Наше', clientUpdatedAt: T(50) }, 5, null), remote({ color: '#222222' }), 9, ctx());
    expect(kept.outcome).toBe('keptLocal');
    expect(kept.row).toMatchObject({ name: 'Наше', color: BASE.color, serverSeq: 9, dirty: 1 });
  });

  it('нет контекста (старый вызов): строка с базой тоже сливается целиком', () => {
    const r = mergeRemoteRow(dirtyLocal({ name: 'Наше' }), remote({ color: '#222222' }), 9);
    expect(r.outcome).toBe('lostLocal');
  });

  it('«чистая» локальная строка и отсутствующая — как всегда', () => {
    const clean: LocalRow<Wallet> = { ...BASE, dirty: 0, serverSeq: 5, syncError: null };
    expect(mergeRemoteRow(undefined, remote({}), 9, ctx()).outcome).toBe('inserted');
    expect(mergeRemoteRow(clean, remote({}), 9, ctx()).outcome).toBe('replaced');
    expect(mergeRemoteRow(clean, remote({}), 5, ctx())).toEqual({ outcome: 'ignoredStale', row: null });
  });
});

describe('sameContent / snapshotRow', () => {
  it('содержимое сравнивается по группам; служебные поля версии в счёт не идут', () => {
    expect(sameContent('wallets', BASE, { ...BASE, clientUpdatedAt: T(99), deviceId: 'other' })).toBe(true);
    expect(sameContent('wallets', BASE, { ...BASE, name: 'другое' })).toBe(false);
    expect(sameContent('wallets', BASE, { ...BASE, archivedAt: T(1) })).toBe(false);
  });

  it('снимок содержит ровно колонки договора, без локальных полей', () => {
    const snap = snapshotRow('wallets', { ...BASE, dirty: 1, serverSeq: 5, syncError: 'x', dirtyBase: { a: 1 } });
    expect(Object.keys(snap).sort()).toEqual(Object.keys(BASE).sort());
    expect(snap).toEqual(BASE);
  });
});

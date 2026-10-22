import { useCallback, useSyncExternalStore } from 'react';
import { newId } from '@/db';
import type { UUID } from '@/domain/types';
import type { TxPrefill } from '@/features/transactions/prefill';
import { addTemplate, insertTemplate, parseTemplates, removeTemplate, renameTemplate, type AddResult, type Template } from './templates';

/**
 * Шаблоны на этом устройстве: localStorage, отдельно для каждого человека. В облако не уходят, поэтому на другом телефоне их нужно
 * завести заново. Если хранилище недоступно (приватный режим, переполнено), шаблоны живут до перезагрузки страницы.
 */

const NONE: readonly Template[] = [];
const known = new Map<string, readonly Template[]>();
const listeners = new Set<() => void>();
const storageKey = (userId: string): string => `finora:templates:${userId}`;

/** Шаблоны человека (один и тот же массив, пока ничего не менялось: так нужно useSyncExternalStore). */
export function readTemplates(userId: string): readonly Template[] {
  const key = storageKey(userId);
  const cached = known.get(key);
  if (cached) return cached;
  let list: readonly Template[] = NONE;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const parsed = parseTemplates(JSON.parse(raw));
      if (parsed.length > 0) list = parsed;
    }
  } catch {
    // хранилище недоступно или в нём не JSON: начинаем с пустого списка
  }
  known.set(key, list);
  return list;
}

function emit(): void {
  for (const l of listeners) l();
}

function write(userId: string, templates: readonly Template[]): void {
  const key = storageKey(userId);
  const next = templates.length === 0 ? NONE : templates;
  known.set(key, next);
  try {
    if (next.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // хранилище недоступно: действует список в памяти
  }
  emit();
}

/** Новый шаблон; ok: false — отказ с причиной (полный список, пустое название, негодная заготовка). */
export function saveTemplate(userId: string, name: string, prefill: TxPrefill): AddResult {
  const result = addTemplate(readTemplates(userId), { id: newId(), name, prefill });
  if (result.ok) write(userId, result.templates);
  return result;
}

export function renameStoredTemplate(userId: string, id: UUID, name: string): void {
  write(userId, renameTemplate(readTemplates(userId), id, name));
}

/** Удаляет и возвращает то, что нужно для «Отменить» (сам шаблон и его место в списке); null — такого нет. */
export function deleteStoredTemplate(userId: string, id: UUID): { template: Template; index: number } | null {
  const list = readTemplates(userId);
  const index = list.findIndex((t) => t.id === id);
  if (index < 0) return null;
  const template = list[index]!;
  write(userId, removeTemplate(list, id));
  return { template, index };
}

export function restoreStoredTemplate(userId: string, template: Template, index: number): void {
  write(userId, insertTemplate(readTemplates(userId), template, index));
}

/** Забыть всё прочитанное (тесты и смена человека): следующее чтение возьмёт данные из хранилища. */
export function forgetTemplatesCache(): void {
  known.clear();
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = () => {
    known.clear(); // изменили в другой вкладке
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface TemplatesApi {
  templates: readonly Template[];
  save: (name: string, prefill: TxPrefill) => AddResult;
  rename: (id: UUID, name: string) => void;
  remove: (id: UUID) => { template: Template; index: number } | null;
  restore: (template: Template, index: number) => void;
}

export function useTemplates(userId: string): TemplatesApi {
  const templates = useSyncExternalStore(
    subscribe,
    () => readTemplates(userId),
    () => NONE,
  );
  const save = useCallback((name: string, prefill: TxPrefill) => saveTemplate(userId, name, prefill), [userId]);
  const rename = useCallback((id: UUID, name: string) => renameStoredTemplate(userId, id, name), [userId]);
  const remove = useCallback((id: UUID) => deleteStoredTemplate(userId, id), [userId]);
  const restore = useCallback((template: Template, index: number) => restoreStoredTemplate(userId, template, index), [userId]);
  return { templates, save, rename, remove, restore };
}

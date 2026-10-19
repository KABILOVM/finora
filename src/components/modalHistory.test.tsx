import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropModalAnchor, resetModalHistoryForTests, runWithoutModalAnchor } from './modalHistory';
import { Sheet } from './Sheet';
import { act, render, screen, user } from './testUtils';

const wait = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const flagged = () => typeof (window.history.state as { __sumoimaModal?: unknown } | null)?.__sumoimaModal === 'string';
const back = async () => {
  act(() => window.history.back());
  await wait();
};

function Two({ dirty = false, history = true }: { dirty?: boolean; history?: boolean }) {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <>
      <button onClick={() => setFirst(true)}>Открыть первое</button>
      <Sheet open={first} onClose={() => setFirst(false)} title="Первое" isDirty={dirty} history={history}>
        <button onClick={() => setSecond(true)}>Открыть второе</button>
      </Sheet>
      <Sheet open={second} onClose={() => setSecond(false)} title="Второе" history={history}>
        <p>внутри</p>
      </Sheet>
    </>
  );
}

/** Кнопка «Закрыть» именно в вопросе «Закрыть без сохранения?» (такая же подпись есть у × окон). */
const confirmClose = (): HTMLElement => {
  const ask = dlg('Закрыть без сохранения?');
  const btn = Array.from(ask?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Закрыть');
  if (!btn) throw new Error('нет кнопки «Закрыть» в вопросе');
  return btn;
};

const dlg = (name: string) => screen.queryByRole('dialog', { name }) ?? screen.queryByRole('alertdialog', { name });

let push: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetModalHistoryForTests();
  push = vi.spyOn(window.history, 'pushState');
  window.history.replaceState({ idx: 3, key: 'k', usr: null }, '');
});
afterEach(async () => {
  await wait(); // дать отработать отложенному снятию записи
  push.mockRestore();
  resetModalHistoryForTests();
});

describe('«Назад» закрывает окно, а не страницу', () => {
  it('одна запись в истории на всю стопку окон', async () => {
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(flagged()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Открыть второе' }));
    expect(push).toHaveBeenCalledTimes(1); // второе окно записи не добавило
  });

  it('«Назад» закрывает верхнее окно, затем нижнее; состояние роутера (idx, key) не теряется', async () => {
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await user.click(screen.getByRole('button', { name: 'Открыть второе' }));
    expect(window.history.state).toMatchObject({ idx: 3, key: 'k' });

    await back();
    await wait();
    expect(dlg('Второе')).toBeNull();
    expect(dlg('Первое')).not.toBeNull();
    expect(flagged()).toBe(true); // осталось окно — запись снова на месте

    await back();
    await wait();
    expect(dlg('Первое')).toBeNull();
    expect(flagged()).toBe(false);
    expect(window.history.state).toMatchObject({ idx: 3, key: 'k' });
  });

  it('закрыли крестиком — запись снимается, следующий «Назад» не закрывает ничего лишнего', async () => {
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await wait(60);
    expect(dlg('Первое')).toBeNull();
    expect(flagged()).toBe(false);
    // повторное открытие снова заводит ровно одну запись
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    expect(push).toHaveBeenCalledTimes(2);
    expect(flagged()).toBe(true);
  });

  it('Esc закрывает верхнее окно и тоже снимает запись', async () => {
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await user.click(screen.getByRole('button', { name: 'Открыть второе' }));
    await user.keyboard('{Escape}');
    await wait(60);
    expect(dlg('Второе')).toBeNull();
    expect(dlg('Первое')).not.toBeNull();
    expect(flagged()).toBe(true);
    await user.keyboard('{Escape}');
    await wait(60);
    expect(flagged()).toBe(false);
  });

  it('в StrictMode (эффекты запускаются дважды) запись одна и снимается после закрытия', async () => {
    render(
      <StrictMode>
        <Two />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await wait(60);
    expect(push).toHaveBeenCalledTimes(1);
    expect(flagged()).toBe(true);
    await user.keyboard('{Escape}');
    await wait(60);
    expect(flagged()).toBe(false);
  });

  it('окно с history={false} записи не заводит', async () => {
    render(<Two history={false} />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    expect(push).not.toHaveBeenCalled();
    expect(flagged()).toBe(false);
  });
});

describe('переход по истории из кода при открытом окне', () => {
  it('dropModalAnchor снимает якорь и только потом зовёт переход; без окон сразу возвращает false', async () => {
    let called = 0;
    expect(dropModalAnchor(() => called++)).toBe(false);
    expect(called).toBe(0);

    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    expect(flagged()).toBe(true);
    // как закрытие /add: переход закрывает и само окно
    let flaggedAtLeave: boolean | null = null;
    const leave = () => {
      called++;
      flaggedAtLeave = flagged(); // переход из кода видит страницу уже без якоря
      act(() => screen.getAllByRole('button', { name: 'Закрыть' })[0]!.click());
    };
    expect(dropModalAnchor(leave)).toBe(true);
    expect(called).toBe(0); // переход ждёт, пока якорь уйдёт
    await wait(80);
    expect(called).toBe(1);
    expect(flaggedAtLeave).toBe(false);
    expect(dlg('Первое')).toBeNull();
    await wait(80); // act вложен в ожидание теста и закрыл окно в самом конце: запись снимается следом
    expect(flagged()).toBe(false);
    expect(window.history.state).toMatchObject({ idx: 3, key: 'k' });
  });
});

describe('чужие и оставшиеся записи', () => {
  it('запись с пометкой от прошлой загрузки страницы или снятого якоря не мешает: первый «Назад» закрывает окно', async () => {
    window.history.replaceState({ idx: 3, key: 'k', usr: null, __sumoimaModal: 'old-1' }, '');
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    expect(dlg('Первое')).not.toBeNull();
    await back();
    await wait();
    expect(dlg('Первое')).toBeNull();
  });

  it('пока код уходит по истории сам, новый якорь не ставится; потом окна, оставшиеся открытыми, получают запись', async () => {
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(dropModalAnchor(() => undefined)).toBe(true); // окно при этом остаётся открытым
    await wait(80);
    expect(flagged()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Открыть второе' })); // другое окно открылось посреди перехода
    expect(push).toHaveBeenCalledTimes(1);
    expect(flagged()).toBe(false);
    await wait(700);
    expect(push).toHaveBeenCalledTimes(2);
    expect(flagged()).toBe(true);
  });

  it('runWithoutModalAnchor без окон зовёт переход сразу, с окном — после снятия якоря', async () => {
    let at: boolean[] = [];
    runWithoutModalAnchor(() => at.push(flagged()));
    expect(at).toEqual([false]);

    at = [];
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    runWithoutModalAnchor(() => at.push(flagged()));
    expect(at).toEqual([]);
    await wait(80);
    expect(at).toEqual([false]);
  });
});

describe('закрытие окна с несохранённым вводом', () => {
  it('× спрашивает «Закрыть без сохранения?»: «Остаться» оставляет окно, «Закрыть» закрывает', async () => {
    render(<Two dirty />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await user.click(screen.getAllByRole('button', { name: 'Закрыть' })[0]!);
    expect(dlg('Закрыть без сохранения?')).not.toBeNull();
    expect(dlg('Первое')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Остаться' }));
    expect(dlg('Закрыть без сохранения?')).toBeNull();
    expect(dlg('Первое')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(dlg('Закрыть без сохранения?')).not.toBeNull();
    await user.click(confirmClose());
    expect(dlg('Первое')).toBeNull();
    expect(dlg('Закрыть без сохранения?')).toBeNull();
  });

  it('«Назад» вместо ухода со страницы задаёт тот же вопрос; второй «Назад» отвечает «Остаться»', async () => {
    render(<Two dirty />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await back();
    await wait();
    expect(dlg('Закрыть без сохранения?')).not.toBeNull();
    expect(flagged()).toBe(true); // запись снова на месте, ещё один «Назад» не уведёт со страницы

    await back();
    await wait();
    expect(dlg('Закрыть без сохранения?')).toBeNull();
    expect(dlg('Первое')).not.toBeNull();
  });

  it('без правок вопрос не задаётся', async () => {
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Открыть первое' }));
    await user.click(screen.getAllByRole('button', { name: 'Закрыть' })[0]!);
    expect(dlg('Закрыть без сохранения?')).toBeNull();
    expect(dlg('Первое')).toBeNull();
  });
});

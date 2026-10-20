import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActionMenu } from './ActionMenu';
import { ListRow } from './ListRow';
import { Notice } from './Notice';
import { SectionHeader } from './SectionHeader';
import { Skeleton } from './Skeleton';
import { Switch, SwitchTrack } from './Switch';
import { findByRole, render, screen, user, waitFor } from './testUtils';

describe('Switch', () => {
  function Harness({ onChange }: { onChange?: (v: boolean) => void }) {
    const [on, setOn] = useState(false);
    return (
      <Switch
        checked={on}
        label="Напоминания"
        onChange={(v) => {
          onChange?.(v);
          setOn(v);
        }}
      />
    );
  }

  it('role="switch" с названием, aria-checked переключается нажатием', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Напоминания' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('название берётся из видимой подписи (labelledBy), aria-label не ставится; disabled не нажимается; busy виден в aria-busy', async () => {
    const onChange = vi.fn();
    render(
      <>
        <span id="lbl">Замок</span>
        <Switch checked labelledBy="lbl" disabled busy onChange={onChange} />
      </>,
    );
    const sw = screen.getByRole('switch', { name: 'Замок' });
    expect(sw).not.toHaveAttribute('aria-label');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-busy', 'true');
    await user.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('область касания не меньше 44 px по высоте (h-11), дорожка — только картинка (aria-hidden)', () => {
    render(<Switch checked={false} label="x" onChange={() => undefined} />);
    expect(screen.getByRole('switch', { name: 'x' }).className).toMatch(/\bh-11\b/);
    const { container } = render(<SwitchTrack checked />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Notice', () => {
  it('ошибка читается сразу (alert), остальное — вежливо (status); роль можно задать явно', () => {
    render(
      <>
        <Notice tone="danger">Ошибка</Notice>
        <Notice tone="warning">Предупреждение</Notice>
        <Notice>Подсказка</Notice>
        <Notice tone="success" role="note">
          Готово
        </Notice>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Ошибка');
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByRole('note')).toHaveTextContent('Готово');
  });

  it('live: плашка с ролью note зачитывается по aria-live, не становясь «status»', () => {
    render(
      <Notice role="note" live="polite">
        Готово
      </Notice>,
    );
    const el = screen.getByRole('note');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('действие показывается под текстом', () => {
    render(<Notice tone="warning" action={<button>Повторить</button>}>Не получилось</Notice>);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('для скринридера пустое место (aria-hidden) и берёт общий класс блика', () => {
    const { container } = render(<Skeleton className="h-4 w-8" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toMatch(/\bskeleton\b/);
    expect(el.className).toMatch(/\bh-4\b/);
  });
});

describe('SectionHeader', () => {
  it('h2 с id для aria-labelledby и действием справа', () => {
    render(<SectionHeader id="grp" action={<a href="#/x">Все</a>}>Деньги</SectionHeader>);
    const h = screen.getByRole('heading', { level: 2, name: 'Деньги' });
    expect(h).toHaveAttribute('id', 'grp');
    expect(screen.getByRole('link', { name: 'Все' })).toBeTruthy();
  });
});

describe('ListRow со ссылкой', () => {
  it('to — строка становится ссылкой (а не кнопкой) и главнее onClick', () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <ListRow title="Кошельки" to="/wallets" onClick={onClick} chevron />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Кошельки/ });
    expect(link).toHaveAttribute('href', '/wallets');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('без to — кнопка, как раньше', async () => {
    const onClick = vi.fn();
    render(<ListRow title="Категория" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: /Категория/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ActionMenu', () => {
  const items = (onA = vi.fn(), onB = vi.fn()) => [
    { key: 'a', label: 'Править', hint: 'Изменить данные', icon: 'edit' as const, onSelect: onA },
    { key: 'b', label: 'Удалить', tone: 'danger' as const, onSelect: onB },
  ];

  it('кнопка «⋯» открывает окно с действиями; у действия имя — его название, пояснение — описание', async () => {
    render(<ActionMenu items={items()} label="Ещё действия по долгу" title="Долг" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ещё действия по долгу' }));
    const dlg = await findByRole('dialog', { name: 'Долг' });
    const edit = screen.getByRole('button', { name: 'Править' });
    expect(dlg.contains(edit)).toBe(true);
    const describedBy = edit.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Изменить данные');
    expect(screen.getByRole('button', { name: 'Удалить' }).className).toContain('text-danger');
  });

  it('выбор действия запускает его один раз и закрывает окно', async () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(<ActionMenu items={items(onA, onB)} />);
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }));
    await user.click(await findByRole('button', { name: 'Править' }));
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape закрывает окно, ничего не запуская; без действий кнопки «⋯» нет', async () => {
    const onA = vi.fn();
    const { rerender } = render(<ActionMenu items={items(onA)} />);
    await user.click(screen.getByRole('button', { name: 'Ещё действия' }));
    await findByRole('dialog', { name: 'Действия' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onA).not.toHaveBeenCalled();
    rerender(<ActionMenu items={[]} />);
    expect(screen.queryByRole('button', { name: 'Ещё действия' })).toBeNull();
  });
});

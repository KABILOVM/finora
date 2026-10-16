-- =============================================================================
-- FINORA — схема базы данных для Supabase (Postgres)
--
-- ЧТО ЭТО
--   Таблицы личного учёта денег: настройки, кошельки, категории, операции (этап 1) и долги, бюджеты,
--   регулярные платежи (этап 2, раздел 8 в конце файла), список покупок (раздел 10), цели накопления (раздел 11: две колонки
--   у кошельков), напоминания о лимитах бюджета (раздел 12), города для погоды (раздел 13: одна колонка у настроек) плюс общие курсы валют. Итого 9 таблиц:
--   settings, wallets, categories, debts, budgets, recurring_rules, transactions, shopping_items, exchange_rates.
--   Правила доступа (у каждого пользователя видны и меняются только СВОИ данные)
--   и защитный триггер, который решает конфликты между устройствами
--   («побеждает самая поздняя правка») и выдаёт номера для синхронизации.
--
-- ВНИМАНИЕ: запускать ТОЛЬКО в проекте Supabase, созданном для Finora.
--   В проекте другой системы (CRM и т. п.) этот файл добавит чужие таблицы и правила.
--
-- КАК ПРИМЕНИТЬ
--   1. Supabase -> SQL Editor -> New query.
--   2. Вставить весь файл целиком -> Run.
--   3. Файл можно запускать повторно: ничего не удаляется и не дублируется.
--
-- ЧТО СДЕЛАТЬ ПОСЛЕ
--   1. Регистрация делается в самом приложении («Нет аккаунта? Зарегистрироваться»):
--      Authentication -> Sign In / Providers -> «Allow new users to sign up» должно быть ВКЛЮЧЕНО.
--      Закрытый круг: выключить его и создавать людей вручную (Authentication -> Users -> «Add user»,
--      «Auto Confirm User»).
--   2. «Confirm email»: если включено, после регистрации нужно подтвердить почту по письму.
--   3. Встроенная почта Supabase шлёт письма только членам команды проекта, поэтому
--      «Confirm email» для друзей лучше выключить — или подключить свой SMTP.
--   4. Project Settings -> API: скопировать Project URL и публичный (anon / publishable)
--      ключ в .env приложения. Ключ service_role в приложение НЕ класть никогда.
--   Названия пунктов меню в Supabase могут отличаться от написанных здесь.
--
-- ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ ЗАШИТЫ
--   * Физического удаления нет ни у кого: удаление = deleted_at (нет политик и прав DELETE).
--   * user_id всегда ставит сервер (из входа), присланное клиентом значение игнорируется.
--   * Проверка версии (compare-and-set): правка может нести base_seq — номер server_seq, поверх которого она сделана.
--     Если строка на сервере уже ушла дальше (другое устройство записало раньше), вся пачка отвергается ошибкой 40001
--     «sync_conflict», ничего не записывается; клиент забирает свежее, объединяет и отправляет заново. Точный повтор уже
--     принятой правки (та же пара client_updated_at, device_id) — не конфликт. Без base_seq проверки нет (старые клиенты).
--   * Правка принимается, только если (client_updated_at, device_id) СТРОГО больше сохранённой;
--     иначе она молча игнорируется — повторная отправка безопасна.
--   * Метка дальше «сейчас + 5 минут» зажимается, а повтор такой же правки получает ту же зажатую метку
--     (журнал private.sync_future_stamps): повтор не плодит новых номеров и не затирает чужие более новые правки.
--   * Каждая принятая запись получает новый server_seq — курсор синхронизации.
--   * Колонки таблиц ОБЯЗАНЫ совпадать с TABLE_SPECS в src/sync/tables.ts.
--   * Длина текста ограничена: имя, заметка, device_id — в create table; color, icon, fx_source — в разделе 7 (в конце файла).
--     Каждое такое правило зеркалится в src/sync/memoryRules.ts (сервер в памяти для тестов); совпадение с этим файлом
--     проверяет tests/sync/memory.differential.test.ts.
--   * Этап 2 (раздел 8): таблицы debts, budgets, recurring_rules и колонки transactions.debt_id / recurring_rule_id добавляются
--     блоками «if not exists» ПОВЕРХ базы этапа 1: данные не трогаются, файл по-прежнему можно запускать повторно.
--     Комиссия перевода хранится в transactions.base_amount_minor (для перевода это не 0, а комиссия, 0..1e15).
--   * Если схему придётся менять — добавляйте новые блоки в конец файла (alter ... if not exists),
--     а не правьте create table: для уже созданных таблиц он ничего не меняет.
-- =============================================================================


-- 1. Служебная схема и курсор синхронизации ----------------------------------
-- Схема private не открыта наружу: через API её не видно и обратиться к ней нельзя.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Глобальный курсор: числа только растут. Пропуски в нумерации (откат, повтор) — это нормально.
create sequence if not exists private.sync_seq;
revoke all on sequence private.sync_seq from public, anon, authenticated;

-- Журнал «меток из будущего». Метку дальше «сейчас + 5 минут» (часы устройства убежали) сервер зажимает.
-- Без журнала повтор той же правки (ответ не дошёл, устройство шлёт снова) получал бы каждый раз НОВУЮ, более
-- позднюю метку: порождал бы правку при каждом повторе и мог затереть более новую правку другого устройства.
-- Поэтому сервер помнит: «правка (строка, устройство, присланная метка) уже видена, ей присвоена метка X».
-- Повтор получает ту же X, а дальше работает обычное правило «побеждает самая поздняя».
create table if not exists private.sync_future_stamps (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  tbl         text        not null,
  row_id      uuid        not null,
  device_id   text        not null,
  raw_at      timestamptz not null,  -- метка так, как её прислало устройство
  assigned_at timestamptz not null,  -- метка, которую сервер присвоил при первой встрече
  primary key (user_id, tbl, row_id, device_id, raw_at)
);
create index if not exists sync_future_stamps_user_idx on private.sync_future_stamps (user_id);
revoke all on table private.sync_future_stamps from public, anon, authenticated;
alter table private.sync_future_stamps enable row level security; -- политик нет: никому, кроме владельца


-- 2. Таблицы -------------------------------------------------------------------
-- Колонки: общие (id ... deleted_at) + свои + служебные (user_id, server_seq, server_updated_at).
-- Типы: int -> bigint, num -> numeric(20,10), ts -> timestamptz, date -> date.
-- Суммы — целые «минорные единицы» (дирамы, центы); допустимый модуль ограничен 1e15,
-- чтобы число всегда помещалось в безопасное целое JavaScript.

-- 2.1. Настройки: одна строка на пользователя, id = id пользователя.
create table if not exists public.settings (
  id                uuid        not null,
  created_at        timestamptz not null,
  client_updated_at timestamptz not null,
  device_id         text        not null,
  deleted_at        timestamptz,
  base_currency     text        not null,
  locale            text        not null,
  week_starts_on    bigint      not null,
  -- мягкая ссылка на кошелёк: без внешнего ключа, чтобы порядок отправки не ломался
  default_wallet_id uuid,
  user_id           uuid        not null,
  server_seq        bigint      not null,
  server_updated_at timestamptz not null,
  constraint settings_pkey primary key (id),
  constraint settings_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint settings_id_is_user check (id = user_id),
  constraint settings_base_currency_fmt check (base_currency ~ '^[A-Z]{3}$'),
  constraint settings_locale_ru check (locale = 'ru'),
  constraint settings_week_starts_on check (week_starts_on in (0, 1)),
  constraint settings_device_id_len check (char_length(device_id) between 1 and 64),
  constraint settings_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at is null or deleted_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 2.2. Кошельки.
create table if not exists public.wallets (
  id                    uuid        not null,
  created_at            timestamptz not null,
  client_updated_at     timestamptz not null,
  device_id             text        not null,
  deleted_at            timestamptz,
  name                  text        not null,
  currency              text        not null,
  kind                  text        not null,
  opening_balance_minor bigint      not null,
  color                 text        not null,
  icon                  text        not null,
  sort_order            bigint      not null,
  archived_at           timestamptz,
  user_id               uuid        not null,
  server_seq            bigint      not null,
  server_updated_at     timestamptz not null,
  constraint wallets_pkey primary key (id),
  -- пара (user_id, id) нужна как цель составных внешних ключей из transactions
  constraint wallets_user_id_id_key unique (user_id, id),
  constraint wallets_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint wallets_currency_fmt check (currency ~ '^[A-Z]{3}$'),
  constraint wallets_kind check (kind in ('cash', 'card', 'bank', 'savings', 'other')),
  constraint wallets_name_len check (char_length(name) between 1 and 80),
  constraint wallets_opening_balance check (opening_balance_minor between -1000000000000000 and 1000000000000000),
  constraint wallets_sort_order check (sort_order between -1000000000000000 and 1000000000000000),
  constraint wallets_device_id_len check (char_length(device_id) between 1 and 64),
  constraint wallets_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at  is null or deleted_at  between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (archived_at is null or archived_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 2.3. Категории.
create table if not exists public.categories (
  id                uuid        not null,
  created_at        timestamptz not null,
  client_updated_at timestamptz not null,
  device_id         text        not null,
  deleted_at        timestamptz,
  name              text        not null,
  kind              text        not null,
  -- мягкая ссылка на родителя: без внешнего ключа (родитель может прийти позже)
  parent_id         uuid,
  color             text        not null,
  icon              text        not null,
  sort_order        bigint      not null,
  archived_at       timestamptz,
  user_id           uuid        not null,
  server_seq        bigint      not null,
  server_updated_at timestamptz not null,
  constraint categories_pkey primary key (id),
  constraint categories_user_id_id_key unique (user_id, id),
  constraint categories_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint categories_kind check (kind in ('expense', 'income')),
  constraint categories_name_len check (char_length(name) between 1 and 80),
  constraint categories_sort_order check (sort_order between -1000000000000000 and 1000000000000000),
  constraint categories_device_id_len check (char_length(device_id) between 1 and 64),
  constraint categories_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at  is null or deleted_at  between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (archived_at is null or archived_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 2.4. Операции. Составные внешние ключи (user_id, ...) не дают сослаться на чужой кошелёк/категорию.
-- Ключи с пустым to_wallet_id / category_id не проверяются (так работает MATCH SIMPLE).
create table if not exists public.transactions (
  id                 uuid        not null,
  created_at         timestamptz not null,
  client_updated_at  timestamptz not null,
  device_id          text        not null,
  deleted_at         timestamptz,
  kind               text        not null,
  wallet_id          uuid        not null,
  to_wallet_id       uuid,
  amount_minor       bigint      not null,
  to_amount_minor    bigint,
  category_id        uuid,
  occurred_on        date        not null,
  note               text        not null,
  base_currency      text        not null,
  base_amount_minor  bigint      not null,
  fx_rate            numeric(20, 10),
  fx_source          text,
  user_id            uuid        not null,
  server_seq         bigint      not null,
  server_updated_at  timestamptz not null,
  constraint transactions_pkey primary key (id),
  constraint transactions_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint transactions_wallet_fk foreign key (user_id, wallet_id) references public.wallets (user_id, id),
  constraint transactions_to_wallet_fk foreign key (user_id, to_wallet_id) references public.wallets (user_id, id),
  constraint transactions_category_fk foreign key (user_id, category_id) references public.categories (user_id, id),
  constraint transactions_kind check (kind in ('expense', 'income', 'transfer')),
  constraint transactions_amount check (amount_minor between 1 and 1000000000000000),
  constraint transactions_base_amount check (base_amount_minor between 0 and 1000000000000000),
  constraint transactions_occurred_on check (occurred_on between date '2000-01-01' and date '2100-01-01'),
  constraint transactions_note_len check (char_length(note) <= 500),
  constraint transactions_base_currency_fmt check (base_currency ~ '^[A-Z]{3}$'),
  -- NaN в numeric считается «больше нуля», поэтому отсекаем его отдельно
  constraint transactions_fx_rate check (fx_rate is null or (fx_rate > 0 and fx_rate <> 'NaN'::numeric)),
  constraint transactions_device_id_len check (char_length(device_id) between 1 and 64),
  -- перевод: обязательны кошелёк и сумма зачисления, кошельки разные, без категории и курса
  constraint transactions_transfer_shape check (
    kind <> 'transfer' or (
      to_wallet_id is not null
      and to_amount_minor is not null
      and to_amount_minor between 1 and 1000000000000000
      and to_wallet_id <> wallet_id
      and category_id is null
      and fx_rate is null
      and fx_source is null
    )
  ),
  -- расход/доход: полей перевода быть не должно
  constraint transactions_plain_shape check (
    kind = 'transfer' or (to_wallet_id is null and to_amount_minor is null)
  ),
  constraint transactions_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at is null or deleted_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);


-- 2.5. Служебная колонка запроса base_seq -------------------------------------------------------
-- Через неё клиент говорит «моя правка сделана поверх версии N» (0 — «строки ещё нет»). PostgREST умеет только
-- insert ... on conflict do update без условий, поэтому условие проверяет триггер sync_guard. В таблице колонка ВСЕГДА пустая:
-- триггер обнуляет её, так что значение прошлой отправки не может повлиять на следующую (в том числе от старого клиента).
-- Таблицы уже могут существовать, поэтому колонка добавляется отдельно; запуск повторяется безопасно.
-- Каждая синхронизируемая таблица ОБЯЗАНА иметь эту колонку (для таблиц этапа 2 — см. 8.4a): тест колонок это проверяет.
alter table public.settings     add column if not exists base_seq bigint;
alter table public.wallets      add column if not exists base_seq bigint;
alter table public.categories   add column if not exists base_seq bigint;
alter table public.transactions add column if not exists base_seq bigint;

-- 3. Защитный триггер синхронизации -----------------------------------------------
-- SECURITY DEFINER: выполняется с правами владельца, потому что обычный пользователь не имеет
-- доступа к схеме private (там счётчик server_seq). search_path = '' — функция не может быть
-- подменена чужими объектами: все имена внутри написаны полностью (схема.имя) или встроенные.
-- Ручная правка этих таблиц из SQL Editor без входа пользователя невозможна: нужен auth.uid().

-- Метка правки, как её хранит сервер. Вызывается из sync_guard под замком записи.
--  1) эту правку уже видели -> та же метка, что присвоили в первый раз (повтор не «молодеет»);
--  2) метка не дальше «сейчас + 5 минут» -> как есть;
--  3) иначе зажимается до «сейчас + 5 минут», и это запоминается в журнале.
-- Правка опознаётся по (пользователь, таблица, строка, устройство, присланная метка).
create or replace function private.sync_stamp(
  p_uid uuid, p_table text, p_id uuid, p_device text, p_raw timestamptz, p_limit timestamptz
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_assigned timestamptz;
begin
  if p_raw is null or p_id is null or p_device is null then
    return p_raw; -- пустое значение отвергнет not null самой таблицы
  end if;

  select s.assigned_at into v_assigned
    from private.sync_future_stamps s
   where s.user_id = p_uid and s.tbl = p_table and s.row_id = p_id
     and s.device_id = p_device and s.raw_at = p_raw;
  if found then
    return v_assigned;
  end if;

  if p_raw <= p_limit then
    return p_raw;
  end if;

  -- слишком длинный device_id в индекс журнала не кладём: строку всё равно отвергнет проверка длины
  if char_length(p_device) <= 64 then
    insert into private.sync_future_stamps (user_id, tbl, row_id, device_id, raw_at, assigned_at)
    values (p_uid, p_table, p_id, p_device, p_raw, p_limit)
    on conflict do nothing;
  end if;
  return p_limit;
end;
$$;

revoke all on function private.sync_stamp(uuid, text, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.sync_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid        := auth.uid();
  -- метки из будущего (часы устройства убежали) зажимаются до «сейчас + 5 минут», см. private.sync_stamp
  v_limit timestamptz := clock_timestamp() + interval '5 minutes';
  -- строка, которая уже лежит на сервере (для проверки версии)
  v_old_seq    bigint;
  v_old_stamp  timestamptz;
  v_old_device text;
  v_old_uid    uuid;
begin
  if v_uid is null then
    raise exception 'Нужно войти в систему' using errcode = '28000';
  end if;

  -- Записывать может один за раз: номер server_seq выдаётся под замком, который держится до конца
  -- транзакции. Поэтому порядок номеров = порядок фиксации, и клиент с курсором «больше N»
  -- не пропустит строку, которая зафиксировалась позже, но получила меньший номер.
  perform pg_advisory_xact_lock(hashtextextended('finora.sync_seq', 0));

  if tg_op = 'INSERT' then
    new.user_id := v_uid;                       -- присланное клиентом значение игнорируется
    if new.created_at > v_limit then new.created_at := v_limit; end if;
    new.client_updated_at := private.sync_stamp(v_uid, tg_table_name, new.id, new.device_id, new.client_updated_at, v_limit);

    -- Проверка версии. Срабатывает на вставку предложенной строки, ДО разбора конфликта по id: если строка уже есть, дальше
    -- её обновит ветка DO UPDATE, а мы успеваем отвергнуть правку, сделанную поверх устаревшей версии. Блокировка выше держится
    -- до конца транзакции, поэтому прочитанная версия не изменится до записи. Чужую строку (тот же id у другого пользователя)
    -- не трогаем: её отвергнет политика доступа, как и раньше.
    if new.base_seq is not null then
      if new.base_seq < 0 then
        raise exception 'base_seq must not be negative' using errcode = '22023';
      end if;
      execute format('select server_seq, client_updated_at, device_id, user_id from %I.%I where id = $1', tg_table_schema, tg_table_name)
        into v_old_seq, v_old_stamp, v_old_device, v_old_uid using new.id;
      if v_old_seq is not null and v_old_uid = v_uid and new.base_seq <> v_old_seq
         -- точный повтор уже принятой правки (ответ потерялся) — не конфликт: ниже его отсеет правило «побеждает большая метка»
         and not (new.client_updated_at = v_old_stamp and new.device_id collate "C" = v_old_device collate "C")
      then
        raise exception 'sync_conflict: row % of "%" is at version %, the write expected %', new.id, tg_table_name, v_old_seq, new.base_seq
          using errcode = '40001',
                detail = format('table=%s id=%s server_seq=%s expected=%s', tg_table_name, new.id, v_old_seq, new.base_seq),
                hint = 'Fetch the newer row, merge it with the local edit and send again.';
      end if;
      new.base_seq := null; -- в таблице колонка всегда пустая
    end if;

    new.server_seq := nextval('private.sync_seq');
    new.server_updated_at := clock_timestamp();
    return new;
  end if;

  -- UPDATE (в том числе ветка DO UPDATE у insert ... on conflict). У upsert сначала срабатывает вставка
  -- (метка уже зажата и записана в журнал), потом сюда приходит та же метка: повторный вызов её не меняет.
  if new.user_id is distinct from old.user_id or new.id is distinct from old.id then
    raise exception 'Менять user_id и id нельзя' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.base_seq := null; -- проверку версии сделала вставка (см. выше); прямой UPDATE её не использует, а значение в таблице не хранится
  new.client_updated_at := private.sync_stamp(v_uid, tg_table_name, new.id, new.device_id, new.client_updated_at, v_limit);

  -- Устаревшая правка или повтор: строка не меняется, ошибки нет.
  -- device_id сравниваем побайтово (collate "C"): так же, как строки сравнивает клиент.
  if new.client_updated_at < old.client_updated_at
     or (new.client_updated_at = old.client_updated_at
         and new.device_id collate "C" <= old.device_id collate "C") then
    return null;
  end if;

  new.server_seq := nextval('private.sync_seq');
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.sync_guard() from public, anon, authenticated;

drop trigger if exists sync_guard on public.settings;
create trigger sync_guard before insert or update on public.settings
  for each row execute function private.sync_guard();

drop trigger if exists sync_guard on public.wallets;
create trigger sync_guard before insert or update on public.wallets
  for each row execute function private.sync_guard();

drop trigger if exists sync_guard on public.categories;
create trigger sync_guard before insert or update on public.categories
  for each row execute function private.sync_guard();

drop trigger if exists sync_guard on public.transactions;
create trigger sync_guard before insert or update on public.transactions
  for each row execute function private.sync_guard();


-- 4. Индексы -----------------------------------------------------------------------

create index if not exists settings_user_seq_idx     on public.settings     (user_id, server_seq);
create index if not exists wallets_user_seq_idx      on public.wallets      (user_id, server_seq);
create index if not exists categories_user_seq_idx   on public.categories   (user_id, server_seq);
create index if not exists transactions_user_seq_idx on public.transactions (user_id, server_seq);
create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);


-- 5. Права и защита строк (RLS) ----------------------------------------------------
-- Сначала забираем всё (в Supabase новым таблицам по умолчанию выдаются все права),
-- потом выдаём только select / insert / update роли authenticated. DELETE нет ни у кого.

revoke all on table public.settings, public.wallets, public.categories, public.transactions
  from public, anon, authenticated;
grant select, insert, update on table public.settings, public.wallets, public.categories, public.transactions
  to authenticated;

alter table public.settings enable row level security;
alter table public.wallets enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

-- (select auth.uid()) вместо auth.uid(): значение считается один раз на запрос, а не на каждую строку.

drop policy if exists settings_select_own on public.settings;
create policy settings_select_own on public.settings for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists settings_insert_own on public.settings;
create policy settings_insert_own on public.settings for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists settings_update_own on public.settings;
create policy settings_update_own on public.settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own on public.wallets for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists wallets_insert_own on public.wallets;
create policy wallets_insert_own on public.wallets for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists wallets_update_own on public.wallets;
create policy wallets_update_own on public.wallets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists categories_select_own on public.categories;
create policy categories_select_own on public.categories for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists categories_insert_own on public.categories;
create policy categories_insert_own on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists categories_update_own on public.categories;
create policy categories_update_own on public.categories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own on public.transactions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own on public.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- 6. Курсы валют (общие для всех) ------------------------------------------------------
-- Читать могут все вошедшие; писать — только service_role (серверная задача), политик на запись нет.

create table if not exists public.exchange_rates (
  as_of      date        not null,
  source     text        not null,
  pivot      text        not null,
  per_unit   jsonb       not null,
  fetched_at timestamptz not null,
  primary key (as_of, source),
  constraint exchange_rates_pivot_fmt check (pivot ~ '^[A-Z]{3}$'),
  constraint exchange_rates_per_unit_obj check (jsonb_typeof(per_unit) = 'object')
);

alter table public.exchange_rates enable row level security;

drop policy if exists exchange_rates_select_auth on public.exchange_rates;
create policy exchange_rates_select_auth on public.exchange_rates for select to authenticated
  using (true);

revoke all on table public.exchange_rates from public, anon, authenticated;
grant select on table public.exchange_rates to authenticated;
grant select, insert, update, delete on table public.exchange_rates to service_role;


-- 7. Ограничения длины текстовых колонок (добавлены позже) ----------------------------
-- Без них вошедший пользователь мог положить в color / icon / fx_source мегабайты текста: это раздувает базу
-- и каждую выборку. Клиент и так режет color / icon по 32 символа (LIMITS.short в src/db/validate.ts);
-- источник курса там — одно из слов 'same', 'nbt', 'server', 'api', 'manual', 'cached' (не длиннее 6 символов).
-- Таблицы выше создаются «if not exists» и в уже созданных проектах не меняются, поэтому ограничения
-- добавляются отдельно, и только если их ещё нет: файл по-прежнему можно запускать повторно.
-- Ограничение добавляется «not valid» (проверяются все НОВЫЕ и изменяемые строки), а затем делается попытка проверить
-- и старые. Если среди старых нашлась слишком длинная строка, файл не падает на полпути: сервер выдаст предупреждение
-- (WARNING), а ограничение останется «не проверенным» для старых строк. Правка такой строки будет принята, только если
-- поле в ней укорочено.
-- Длина считается в символах (char_length), как и у остальных ограничений выше.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('wallets',      'wallets_color_len',          'char_length(color) <= 32'),
      ('wallets',      'wallets_icon_len',           'char_length(icon) <= 32'),
      ('categories',   'categories_color_len',       'char_length(color) <= 32'),
      ('categories',   'categories_icon_len',        'char_length(icon) <= 32'),
      ('transactions', 'transactions_fx_source_len', 'fx_source is null or char_length(fx_source) <= 16')
    ) as c (tbl, cname, expr)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = r.cname and conrelid = format('public.%I', r.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', r.tbl, r.cname, r.expr);
      begin
        execute format('alter table public.%I validate constraint %I', r.tbl, r.cname);
      exception when check_violation then
        raise warning 'В таблице % есть старые строки, нарушающие ограничение %; новые и изменённые строки оно проверяет', r.tbl, r.cname;
      end;
    end if;
  end loop;
end
$$;


-- 8. Этап 2: долги, бюджеты, регулярные платежи ----------------------------------------
-- Всё ниже идемпотентно и накладывается на базу этапа 1 (таблицы «if not exists», колонки «add column if not exists»,
-- внешние ключи и ограничения — только если их ещё нет). Правила те же, что выше: user_id ставит сервер, правка принимается
-- только если метка строго новее, удаления нет, пара (user_id, id) нужна как цель составных внешних ключей.
-- Составные внешние ключи (user_id, ...) не дают сослаться на чужой кошелёк, категорию, долг или правило.
-- Ключи с пустой ссылкой не проверяются (MATCH SIMPLE).
-- Каждое ограничение зеркалится в src/sync/memoryRules.ts под тем же именем.

-- 8.1. Долги. direction: lent — мне должны, borrowed — я должен. Остаток долга нигде не хранится (считается из операций).
create table if not exists public.debts (
  id                uuid        not null,
  created_at        timestamptz not null,
  client_updated_at timestamptz not null,
  device_id         text        not null,
  deleted_at        timestamptz,
  direction         text        not null,
  counterparty      text        not null,
  principal_minor   bigint      not null,
  currency          text        not null,
  opened_on         date        not null,
  due_on            date,
  note              text        not null,
  closed_at         timestamptz,
  archived_at       timestamptz,
  user_id           uuid        not null,
  server_seq        bigint      not null,
  server_updated_at timestamptz not null,
  constraint debts_pkey primary key (id),
  constraint debts_user_id_id_key unique (user_id, id),
  constraint debts_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint debts_direction check (direction in ('lent', 'borrowed')),
  constraint debts_counterparty_len check (char_length(counterparty) between 1 and 80),
  constraint debts_principal check (principal_minor between 1 and 1000000000000000),
  constraint debts_currency_fmt check (currency ~ '^[A-Z]{3}$'),
  constraint debts_opened_on check (opened_on between date '2000-01-01' and date '2100-01-01'),
  constraint debts_due_on check (due_on is null or due_on between date '2000-01-01' and date '2100-01-01'),
  constraint debts_note_len check (char_length(note) <= 500),
  constraint debts_device_id_len check (char_length(device_id) between 1 and 64),
  constraint debts_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at  is null or deleted_at  between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (closed_at   is null or closed_at   between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (archived_at is null or archived_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 8.2. Бюджеты: лимит расходов на месяц в базовой валюте. category_id пустой — общий лимит на все расходы.
-- id клиент считает сам (v5 от пользователя и категории), чтобы два устройства не завели два бюджета на одно и то же.
create table if not exists public.budgets (
  id                uuid        not null,
  created_at        timestamptz not null,
  client_updated_at timestamptz not null,
  device_id         text        not null,
  deleted_at        timestamptz,
  category_id       uuid,
  amount_minor      bigint      not null,
  currency          text        not null,
  period            text        not null,
  archived_at       timestamptz,
  user_id           uuid        not null,
  server_seq        bigint      not null,
  server_updated_at timestamptz not null,
  constraint budgets_pkey primary key (id),
  constraint budgets_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint budgets_category_fk foreign key (user_id, category_id) references public.categories (user_id, id),
  constraint budgets_amount check (amount_minor between 1 and 1000000000000000),
  constraint budgets_currency_fmt check (currency ~ '^[A-Z]{3}$'),
  constraint budgets_period check (period = 'month'),
  constraint budgets_device_id_len check (char_length(device_id) between 1 and 64),
  constraint budgets_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at  is null or deleted_at  between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (archived_at is null or archived_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 8.3. Регулярные платежи. Операции по расписанию клиент создаёт с id v5(правило, 'ГГГГ-ММ-ДД'), поэтому два устройства
-- не задвоят одну и ту же операцию. Форма строки такая же, как у операции: перевод — с кошельком и суммой зачисления,
-- без категории и долга; расход/доход — без полей перевода.
create table if not exists public.recurring_rules (
  id                uuid        not null,
  created_at        timestamptz not null,
  client_updated_at timestamptz not null,
  device_id         text        not null,
  deleted_at        timestamptz,
  kind              text        not null,
  wallet_id         uuid        not null,
  to_wallet_id      uuid,
  amount_minor      bigint      not null,
  to_amount_minor   bigint,
  category_id       uuid,
  debt_id           uuid,
  note              text        not null,
  frequency         text        not null,
  interval_n        bigint      not null,
  start_on          date        not null,
  end_on            date,
  auto_post         bigint      not null,
  archived_at       timestamptz,
  user_id           uuid        not null,
  server_seq        bigint      not null,
  server_updated_at timestamptz not null,
  constraint recurring_rules_pkey primary key (id),
  constraint recurring_rules_user_id_id_key unique (user_id, id),
  constraint recurring_rules_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint recurring_rules_wallet_fk foreign key (user_id, wallet_id) references public.wallets (user_id, id),
  constraint recurring_rules_to_wallet_fk foreign key (user_id, to_wallet_id) references public.wallets (user_id, id),
  constraint recurring_rules_category_fk foreign key (user_id, category_id) references public.categories (user_id, id),
  constraint recurring_rules_debt_fk foreign key (user_id, debt_id) references public.debts (user_id, id),
  constraint recurring_rules_kind check (kind in ('expense', 'income', 'transfer')),
  constraint recurring_rules_amount check (amount_minor between 1 and 1000000000000000),
  constraint recurring_rules_frequency check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  constraint recurring_rules_interval_n check (interval_n between 1 and 1000),
  constraint recurring_rules_start_on check (start_on between date '2000-01-01' and date '2100-01-01'),
  constraint recurring_rules_end_on check (end_on is null or (end_on >= start_on and end_on <= date '2100-01-01')),
  constraint recurring_rules_auto_post check (auto_post in (0, 1)),
  constraint recurring_rules_note_len check (char_length(note) <= 500),
  constraint recurring_rules_device_id_len check (char_length(device_id) between 1 and 64),
  -- перевод: обязательны кошелёк и сумма зачисления, кошельки разные, без категории и долга
  constraint recurring_rules_transfer_shape check (
    kind <> 'transfer' or (
      to_wallet_id is not null
      and to_amount_minor is not null
      and to_amount_minor between 1 and 1000000000000000
      and to_wallet_id <> wallet_id
      and category_id is null
      and debt_id is null
    )
  ),
  -- расход/доход: полей перевода быть не должно
  constraint recurring_rules_plain_shape check (
    kind = 'transfer' or (to_wallet_id is null and to_amount_minor is null)
  ),
  constraint recurring_rules_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at  is null or deleted_at  between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (archived_at is null or archived_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 8.4. Операции: ссылка на долг и на регулярный платёж.
-- Операция с долгом не входит в «Доходы/Расходы» месяца и в бюджеты, но меняет остаток кошелька; у перевода долга быть не может.
-- Комиссия перевода хранится в base_amount_minor (0..1e15): ограничение transactions_base_amount выше этого не запрещает.
alter table public.transactions add column if not exists debt_id uuid;
alter table public.transactions add column if not exists recurring_rule_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_debt_fk' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions
      add constraint transactions_debt_fk foreign key (user_id, debt_id) references public.debts (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_recurring_rule_fk' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions
      add constraint transactions_recurring_rule_fk foreign key (user_id, recurring_rule_id) references public.recurring_rules (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_debt_shape' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions
      add constraint transactions_debt_shape check (kind <> 'transfer' or debt_id is null);
  end if;
end
$$;

-- 8.4a. Служебная колонка запроса base_seq (см. 2.5): без неё общий триггер sync_guard, который читает new.base_seq,
-- падал бы на любой записи в эти таблицы. В таблице колонка всегда пустая.
alter table public.debts           add column if not exists base_seq bigint;
alter table public.budgets         add column if not exists base_seq bigint;
alter table public.recurring_rules add column if not exists base_seq bigint;

-- 8.5. Защитный триггер синхронизации (тот же, что у остальных таблиц).
drop trigger if exists sync_guard on public.debts;
create trigger sync_guard before insert or update on public.debts
  for each row execute function private.sync_guard();

drop trigger if exists sync_guard on public.budgets;
create trigger sync_guard before insert or update on public.budgets
  for each row execute function private.sync_guard();

drop trigger if exists sync_guard on public.recurring_rules;
create trigger sync_guard before insert or update on public.recurring_rules
  for each row execute function private.sync_guard();

-- 8.6. Индексы: курсор синхронизации (user_id, server_seq) у каждой новой таблицы.
create index if not exists debts_user_seq_idx           on public.debts           (user_id, server_seq);
create index if not exists budgets_user_seq_idx         on public.budgets         (user_id, server_seq);
create index if not exists recurring_rules_user_seq_idx on public.recurring_rules (user_id, server_seq);

-- 8.7. Права и защита строк (RLS): как у остальных таблиц — только select / insert / update и только свои строки.
revoke all on table public.debts, public.budgets, public.recurring_rules from public, anon, authenticated;
grant select, insert, update on table public.debts, public.budgets, public.recurring_rules to authenticated;

alter table public.debts           enable row level security;
alter table public.budgets         enable row level security;
alter table public.recurring_rules enable row level security;

drop policy if exists debts_select_own on public.debts;
create policy debts_select_own on public.debts for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists debts_insert_own on public.debts;
create policy debts_insert_own on public.debts for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists debts_update_own on public.debts;
create policy debts_update_own on public.debts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists budgets_select_own on public.budgets;
create policy budgets_select_own on public.budgets for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists budgets_insert_own on public.budgets;
create policy budgets_insert_own on public.budgets for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists budgets_update_own on public.budgets;
create policy budgets_update_own on public.budgets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists recurring_rules_select_own on public.recurring_rules;
create policy recurring_rules_select_own on public.recurring_rules for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists recurring_rules_insert_own on public.recurring_rules;
create policy recurring_rules_insert_own on public.recurring_rules for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists recurring_rules_update_own on public.recurring_rules;
create policy recurring_rules_update_own on public.recurring_rules for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- 9. Этап 3: напоминания (push) ---------------------------------------------------------------
-- Эти три таблицы НЕ синхронизируются через локальную базу устройства: приложение пишет в них напрямую (когда есть сеть),
-- а читает их серверная функция send-reminders. Как везде: authenticated не может удалять строки (только select / insert / update
-- и только свои), поэтому «отписаться» = выставить revoked_at; настоящую чистку делает серверная функция.

-- 9.1. Подписки устройств на push. Одна строка на (пользователь, адрес push-сервиса браузера).
create table if not exists public.push_subscriptions (
  id           uuid        not null default gen_random_uuid(),
  user_id      uuid        not null default auth.uid(),
  device_id    text        not null,
  endpoint     text        not null,
  p256dh       text        not null,
  auth_secret  text        not null,
  user_agent   text        not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- отписка (человек выключил напоминания на этом устройстве); пусто — подписка действует
  revoked_at   timestamptz,
  constraint push_subscriptions_pkey primary key (id),
  constraint push_subscriptions_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint),
  constraint push_subscriptions_endpoint_fmt check (endpoint like 'https://%' and char_length(endpoint) between 12 and 2048),
  constraint push_subscriptions_keys_len check (char_length(p256dh) between 20 and 200 and char_length(auth_secret) between 8 and 100),
  constraint push_subscriptions_device_len check (char_length(device_id) between 1 and 64),
  constraint push_subscriptions_ua_len check (char_length(user_agent) <= 300)
);

-- 9.2. Настройки напоминаний: одна строка на пользователя.
--   hour_local — час (0–23) по часовому поясу timezone, когда присылать; show_details — писать ли в уведомлении названия
--   (по умолчанию нет: на заблокированном экране чужие глаза ничего лишнего не увидят).
create table if not exists public.reminder_settings (
  user_id         uuid        not null default auth.uid(),
  enabled         boolean     not null default false,
  hour_local      smallint    not null default 9,
  timezone        text        not null default 'Asia/Dushanbe',
  remind_payments boolean     not null default true,
  remind_debts    boolean     not null default true,
  remind_daily    boolean     not null default false,
  show_details    boolean     not null default false,
  updated_at      timestamptz not null default now(),
  constraint reminder_settings_pkey primary key (user_id),
  constraint reminder_settings_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint reminder_settings_hour check (hour_local between 0 and 23),
  constraint reminder_settings_tz_len check (char_length(timezone) between 1 and 64)
);

-- 9.3. Журнал отправленного: по нему функция не шлёт одно и то же напоминание дважды за день. Только для service_role
-- (функция), у anon и authenticated прав нет совсем и политик нет.
create table if not exists public.push_log (
  user_id    uuid        not null,
  kind       text        not null,
  ref        text        not null,
  sent_on    date        not null,
  created_at timestamptz not null default now(),
  constraint push_log_pkey primary key (user_id, kind, ref, sent_on),
  constraint push_log_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint push_log_kind check (kind in ('payment', 'debt', 'daily')),
  constraint push_log_ref_len check (char_length(ref) <= 200)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where revoked_at is null;
create index if not exists push_log_sent_on_idx on public.push_log (sent_on);

revoke all on table public.push_subscriptions, public.reminder_settings, public.push_log from public, anon, authenticated;
grant select, insert, update on table public.push_subscriptions, public.reminder_settings to authenticated;

alter table public.push_subscriptions enable row level security;
alter table public.reminder_settings  enable row level security;
alter table public.push_log           enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists reminder_settings_select_own on public.reminder_settings;
create policy reminder_settings_select_own on public.reminder_settings for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists reminder_settings_insert_own on public.reminder_settings;
create policy reminder_settings_insert_own on public.reminder_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists reminder_settings_update_own on public.reminder_settings;
create policy reminder_settings_update_own on public.reminder_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- 10. Список покупок -------------------------------------------------------------------------
-- Одна таблица shopping_items, как у остальных данных: user_id ставит сервер, правка принимается только если метка строго новее,
-- удаления нет (deleted_at), курсор синхронизации — (user_id, server_seq), защита строк (RLS) — только свои.
-- Количество — целое в тысячных долях (1400 = 1,4 кг), цены — целые минорные единицы основной валюты.
-- Отметка «в корзине» (checked_at) и вписанная в магазине цена (price_minor) ставятся вместе. Купленная позиция (purchased_at)
-- обязана быть отмеченной и входить в чек расхода (transaction_id); чек есть только у купленной. Внешнего ключа на transactions нет:
-- у операций нет пары (user_id, id) — это ссылка для показа чека, удалённая операция строки не ломает.
-- Каждое ограничение зеркалится в src/sync/memoryRules.ts под тем же именем.

-- 10.1. Таблица.
create table if not exists public.shopping_items (
  id                uuid        not null,
  created_at        timestamptz not null,
  client_updated_at timestamptz not null,
  device_id         text        not null,
  deleted_at        timestamptz,
  name              text        not null,
  qty_milli         bigint      not null,
  unit              text        not null,
  price_minor       bigint,
  checked_at        timestamptz,
  purchased_at      timestamptz,
  transaction_id    uuid,
  user_id           uuid        not null,
  server_seq        bigint      not null,
  server_updated_at timestamptz not null,
  constraint shopping_items_pkey primary key (id),
  constraint shopping_items_user_fk foreign key (user_id) references auth.users (id) on delete cascade,
  constraint shopping_items_name_len check (char_length(name) between 1 and 80),
  constraint shopping_items_qty check (qty_milli between 1 and 1000000000),
  constraint shopping_items_unit check (unit in ('pcs', 'kg', 'l')),
  constraint shopping_items_price check (price_minor is null or price_minor between 0 and 1000000000000000),
  constraint shopping_items_device_id_len check (char_length(device_id) between 1 and 64),
  -- отметка и цена — вместе
  constraint shopping_items_state_shape check ((checked_at is null) = (price_minor is null)),
  -- купленная: отмечена и с чеком; чек — только у купленной
  constraint shopping_items_purchase_shape check (
    (purchased_at is null and transaction_id is null)
    or (purchased_at is not null and checked_at is not null and transaction_id is not null)
  ),
  constraint shopping_items_ts_sane check (
    created_at        between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and client_updated_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00'
    and (deleted_at   is null or deleted_at   between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (checked_at   is null or checked_at   between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
    and (purchased_at is null or purchased_at between timestamptz '2000-01-01 00:00:00+00' and timestamptz '2100-01-01 00:00:00+00')
  )
);

-- 10.2. Служебная колонка запроса base_seq (см. 2.5) и защитный триггер синхронизации (тот же, что у остальных таблиц).
alter table public.shopping_items add column if not exists base_seq bigint;

drop trigger if exists sync_guard on public.shopping_items;
create trigger sync_guard before insert or update on public.shopping_items
  for each row execute function private.sync_guard();

-- 10.3. Индекс курсора синхронизации.
create index if not exists shopping_items_user_seq_idx on public.shopping_items (user_id, server_seq);

-- 10.4. Права и защита строк (RLS): только select / insert / update и только свои строки.
revoke all on table public.shopping_items from public, anon, authenticated;
grant select, insert, update on table public.shopping_items to authenticated;

alter table public.shopping_items enable row level security;

drop policy if exists shopping_items_select_own on public.shopping_items;
create policy shopping_items_select_own on public.shopping_items for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists shopping_items_insert_own on public.shopping_items;
create policy shopping_items_insert_own on public.shopping_items for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists shopping_items_update_own on public.shopping_items;
create policy shopping_items_update_own on public.shopping_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- 11. Цели накопления --------------------------------------------------------------------
-- У кошелька вида «Накопления» может быть цель: сколько накопить (goal_minor, в минимальных единицах валюты кошелька)
-- и к какой дате (goal_on). Пока цель не задана, обе колонки пустые. Накоплено = остаток кошелька: он считается
-- из операций и в базе не хранится. Срок без суммы приложение не записывает.
-- Блок идемпотентен, как раздел 8: колонки «add column if not exists», ограничения — только если их ещё нет. Данные
-- не трогаются, триггер sync_guard, права и политики доступа остаются прежними (они действуют на таблицу целиком).
-- Старые приложения этих колонок не знают: при записи они их не присылают, и сохранённая цель не затирается.
alter table public.wallets add column if not exists goal_minor bigint;
alter table public.wallets add column if not exists goal_on date;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('wallets', 'wallets_goal_minor', 'goal_minor is null or goal_minor between 1 and 1000000000000000'),
      ('wallets', 'wallets_goal_on',    'goal_on is null or goal_on between date ''2000-01-01'' and date ''2100-01-01''')
    ) as c (tbl, cname, expr)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = r.cname and conrelid = format('public.%I', r.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', r.tbl, r.cname, r.expr);
      begin
        execute format('alter table public.%I validate constraint %I', r.tbl, r.cname);
      exception when check_violation then
        raise warning 'В таблице % есть старые строки, нарушающие ограничение %; новые и изменённые строки оно проверяет', r.tbl, r.cname;
      end;
    end if;
  end loop;
end
$$;


-- 12. Напоминания о лимитах бюджета ----------------------------------------------------------
-- Функция send-reminders (supabase/functions/send-reminders) умеет присылать push, когда расходы месяца дошли до 70% или 90% лимита
-- бюджета или превысили его. Для этого нужен переключатель в настройках напоминаний и новый вид записи в журнале отправленного.
-- Переключатель по умолчанию ВЫКЛЮЧЕН: у тех, у кого напоминания уже включены, новый вид уведомлений сам не появится.
-- Суммы в уведомление не попадают (только целый процент), названия лимитов — только при «Показывать названия».
-- Выполнять до выкладки приложения и до обновления файла функции; повторный запуск безопасен.

-- 12.1. Переключатель.
alter table public.reminder_settings add column if not exists remind_budgets boolean not null default false;

-- 12.2. Журнал отправленного: kind = 'budget', ref = '<id лимита>:<уровень>' (warn / danger / over). По нему функция не шлёт один и тот же
-- уровень лимита дважды за месяц. Таблица небольшая (чистится через 60 суток), пересоздание проверки быстрое.
alter table public.push_log drop constraint if exists push_log_kind;
alter table public.push_log add constraint push_log_kind check (kind in ('payment', 'debt', 'daily', 'budget'));


-- 13. Города для погоды ------------------------------------------------------------------
-- Раздел «Погода» запоминает города и выбранный город. Чтобы выбор был один на все устройства человека, он лежит в настройках:
-- колонка weather, один текст (JSON: {"v":1,"selected":"37.50,70.25","cities":[{"id","name","region","lat","lon","here"?}]}).
-- Пока человек ничего не выбирал, колонка пустая. Формат и все проверки полей — в приложении (src/domain/weatherPlaces.ts); сервер
-- ограничивает только длину: города — это не деньги, а лишний текст не должен раздувать строку настроек.
-- Блок идемпотентен, как разделы 8 и 11: колонка «add column if not exists», ограничение — только если его ещё нет. Данные не
-- трогаются, триггер sync_guard, права и политики доступа остаются прежними (они действуют на таблицу целиком).
-- Старые приложения колонки не знают: при записи они её не присылают, и сохранённый выбор не затирается.
-- Выполнять до выкладки приложения; повторный запуск безопасен.
alter table public.settings add column if not exists weather text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'settings_weather_len' and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings add constraint settings_weather_len check (weather is null or char_length(weather) <= 8000) not valid;
    begin
      alter table public.settings validate constraint settings_weather_len;
    exception when check_violation then
      raise warning 'В таблице settings есть старые строки, нарушающие ограничение settings_weather_len; новые и изменённые строки оно проверяет';
    end;
  end if;
end
$$;

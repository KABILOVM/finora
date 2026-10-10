-- =============================================================================
-- FINORA — схема базы данных для Supabase (Postgres)
--
-- ЧТО ЭТО
--   Таблицы личного учёта денег (настройки, кошельки, категории, операции),
--   правила доступа (у каждого пользователя видны и меняются только СВОИ данные)
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
--   1. Authentication -> Users -> «Add user» -> создать пользователей вручную (до 5)
--      и включить автоподтверждение («Auto Confirm User»).
--   2. Authentication -> Sign In / Providers: выключить публичную регистрацию
--      («Allow new users to sign up») — круг закрытый.
--   3. Встроенная почта Supabase шлёт письма только членам команды проекта, поэтому
--      «Confirm email» для друзей лучше выключить — или подключить свой SMTP.
--   4. Project Settings -> API: скопировать Project URL и публичный (anon / publishable)
--      ключ в .env приложения. Ключ service_role в приложение НЕ класть никогда.
--   Названия пунктов меню в Supabase могут отличаться от написанных здесь.
--
-- ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ ЗАШИТЫ
--   * Физического удаления нет ни у кого: удаление = deleted_at (нет политик и прав DELETE).
--   * user_id всегда ставит сервер (из входа), присланное клиентом значение игнорируется.
--   * Правка принимается, только если (client_updated_at, device_id) СТРОГО больше сохранённой;
--     иначе она молча игнорируется — повторная отправка безопасна.
--   * Метка дальше «сейчас + 5 минут» зажимается, а повтор такой же правки получает ту же зажатую метку
--     (журнал private.sync_future_stamps): повтор не плодит новых номеров и не затирает чужие более новые правки.
--   * Каждая принятая запись получает новый server_seq — курсор синхронизации.
--   * Колонки таблиц ОБЯЗАНЫ совпадать с TABLE_SPECS в src/sync/tables.ts.
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

alter table public.settings     enable row level security;
alter table public.wallets      enable row level security;
alter table public.categories   enable row level security;
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

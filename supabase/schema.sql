-- Lyrics Hub — esquema do banco (Supabase / Postgres)
-- Rode este arquivo inteiro em: Supabase > SQL Editor > New query > Run

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','teacher')),
  name text not null,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

-- Horário fixo mensal de um professor em uma sala
create table slots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id),
  teacher_id uuid not null references profiles(id),
  weekday int not null check (weekday between 0 and 6), -- 0 = domingo
  start_time time not null,
  end_time time not null,
  student text,
  active boolean not null default true
);

-- Impede dois professores no mesmo horário da mesma sala
create unique index slots_no_double_booking on slots (room_id, weekday, start_time) where active;

-- Histórico de cada horário (aula dada, falta, troca, observação, pagamento)
create table slot_events (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots(id) on delete cascade,
  kind text not null check (kind in ('aula','falta','troca','obs','pagamento')),
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table charges (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id),
  amount_cents int not null check (amount_cents > 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','paid','overdue')),
  method text check (method in ('pix','machine')),
  paid_at timestamptz,
  mp_payment_id text,
  cycle text not null default to_char(now(), 'YYYY-MM')
);

create table push_tokens (
  user_id uuid not null references profiles(id) on delete cascade,
  token text primary key
);

-- Função auxiliar: o usuário logado é admin?
create function is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active)
$$;

alter table profiles enable row level security;
alter table rooms enable row level security;
alter table slots enable row level security;
alter table slot_events enable row level security;
alter table charges enable row level security;
alter table push_tokens enable row level security;

-- PROFILES: professor vê só o próprio; admin vê e edita todos.
-- Ninguém além do servidor (Edge Function) cria professores.
create policy profiles_select on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_admin_update on profiles for update using (is_admin());

-- ROOMS: todos logados leem; só admin altera.
create policy rooms_select on rooms for select using (auth.uid() is not null);
create policy rooms_admin on rooms for all using (is_admin()) with check (is_admin());

-- SLOTS: professor vê só os seus; admin vê e altera tudo.
create policy slots_select on slots for select using (teacher_id = auth.uid() or is_admin());
create policy slots_admin on slots for all using (is_admin()) with check (is_admin());

-- HISTÓRICO: professor lê e anota só nos seus horários; admin tudo.
create policy events_select on slot_events for select using (
  is_admin() or exists (select 1 from slots s where s.id = slot_id and s.teacher_id = auth.uid()));
create policy events_insert on slot_events for insert with check (
  created_by = auth.uid() and kind in ('aula','falta','troca','obs') and
  (is_admin() or exists (select 1 from slots s where s.id = slot_id and s.teacher_id = auth.uid())));
create policy events_admin on slot_events for all using (is_admin()) with check (is_admin());

-- FINANCEIRO: sem nenhuma política para professor = acesso negado.
-- (Professor também não vê cobrança própria no app; só admins.)
create policy charges_admin on charges for all using (is_admin()) with check (is_admin());

-- PUSH TOKENS: cada um gerencia o próprio.
create policy tokens_own on push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Dados iniciais: o estúdio tem uma única sala
insert into rooms (name) values ('Sala');


-- ============ PREÇOS E RESERVA ============

-- Mesma regra de src/config.ts. Valor mensal por horário semanal, em centavos.
create function price_per_slot(n int) returns int language sql immutable as $$
  select case when n <= 0 then 0 when n <= 3 then 15000 when n <= 6 then 12000 else 10000 end
$$;

-- Disponibilidade PÚBLICA (sem login): só diz quais horários estão ocupados.
-- Não revela nomes de professores nem alunos.
create function availability() returns json
language sql security definer set search_path = public stable as $$
  select json_build_object(
    'rooms', coalesce((select json_agg(json_build_object('id', id, 'name', name) order by name) from rooms), '[]'::json),
    'taken', coalesce((select json_agg(json_build_object(
        'room_id', room_id, 'weekday', weekday, 'start', to_char(start_time, 'HH24:MI'))) from slots where active), '[]'::json)
  )
$$;
grant execute on function availability() to anon, authenticated;

-- Fechamento de horários pelo professor logado. O preço é calculado AQUI, nunca pelo app.
-- p = [{"room_id": "...", "weekday": 1, "start": "14:00"}, ...]
create function book_slots(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  new_id uuid;
  total int;
  per int;
  due int;
  already int;
  diff int;
  cyc text := to_char(now(), 'YYYY-MM');
begin
  if not exists (select 1 from profiles where id = uid and role = 'teacher' and active) then
    raise exception 'Apenas professores cadastrados podem fechar horários.';
  end if;
  if jsonb_array_length(p) = 0 then raise exception 'Nenhum horário selecionado.'; end if;

  for item in select * from jsonb_array_elements(p) loop
    if (item->>'weekday')::int not between 1 and 6
       or (item->>'start')::time < time '09:00'
       or (item->>'start')::time > (case when (item->>'weekday')::int = 6 then time '17:00' else time '21:00' end)
       or extract(minute from (item->>'start')::time) <> 0 then
      raise exception 'Horário inválido.';
    end if;
    begin
      insert into slots (room_id, teacher_id, weekday, start_time, end_time)
      values ((item->>'room_id')::uuid, uid, (item->>'weekday')::int,
              (item->>'start')::time, (item->>'start')::time + interval '1 hour')
      returning id into new_id;
      insert into slot_events (slot_id, kind, note, created_by) values (new_id, 'obs', 'Horário fechado.', uid);
    exception when unique_violation then
      raise exception 'Um dos horários acabou de ser ocupado. Atualize e escolha outro.';
    end;
  end loop;

  select count(*) into total from slots where teacher_id = uid and active;
  per := price_per_slot(total);
  due := total * per;
  select coalesce(sum(amount_cents), 0) into already from charges where teacher_id = uid and cycle = cyc;
  diff := due - already;
  if diff > 0 then
    insert into charges (teacher_id, amount_cents, due_date, cycle)
    values (uid, diff, current_date + 5, cyc);
  end if;

  return json_build_object('count', total, 'per_slot_cents', per, 'total_cents', due, 'charged_cents', greatest(diff, 0));
end $$;
grant execute on function book_slots(jsonb) to authenticated;

-- ============ PERMISSÕES ============
-- Em projetos novos do Supabase as tabelas não vêm liberadas. O RLS acima restringe o que cada um enxerga.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

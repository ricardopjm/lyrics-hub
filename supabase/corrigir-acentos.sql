-- Lyrics Hub — CORREÇÃO DE ACENTOS nas mensagens do servidor.
-- Rode em: Supabase > SQL Editor > New query > Run
--
-- Por um problema na cópia, as mensagens de erro e textos com acento de algumas funções ficaram
-- corrompidos (ex.: "Cupom inválido" aparecia como "Cupom inv√álido"). Este arquivo recria essas funções.
-- Pode rodar sem medo: só recria funções; não mexe nos dados. (Precisa ter rodado antes o pendentes.sql.)

create or replace function register_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  insert into push_tokens (user_id, token) values (auth.uid(), p_token)
  on conflict (token) do update set user_id = auth.uid();
end $$;

-- Lyrics Hub — cupons de desconto (no fechamento de horários e na renovação do plano).
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o inicio.sql)
--
-- O cupom é SEMPRE opcional: sem cupom, tudo funciona como antes.
-- Este arquivo substitui a função book_slots do admin-reservas.sql por uma versão com cupom.

-- ---------- tabelas ----------
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                                  -- sempre em maiúsculas
  kind text not null check (kind in ('percent', 'fixed')),    -- porcentagem ou valor fixo em centavos
  value int not null check (value > 0),
  expires_at date,                                            -- vazio = não expira
  max_uses int check (max_uses is null or max_uses > 0),      -- vazio = sem limite
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint coupon_percent_max check (kind <> 'percent' or value <= 100)
);

-- Cada professor usa um mesmo cupom uma vez.
create table if not exists coupon_uses (
  coupon_id uuid not null references coupons(id) on delete cascade,
  teacher_id uuid not null references profiles(id),
  charge_id uuid references charges(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (coupon_id, teacher_id)
);

alter table coupons enable row level security;
alter table coupon_uses enable row level security;
drop policy if exists coupons_admin on coupons;
drop policy if exists coupon_uses_admin on coupon_uses;
-- Só administradores enxergam e mexem nos cupons. Professor só usa o código, pelo servidor.
create policy coupons_admin on coupons for all using (is_admin()) with check (is_admin());
create policy coupon_uses_admin on coupon_uses for select using (is_admin());

grant select, insert, update, delete on coupons to authenticated;
grant select on coupon_uses to authenticated;
grant all on coupons, coupon_uses to service_role;

-- A cobrança guarda o cupom usado e o desconto. Cobrança de R$ 0 é permitida (cupom de 100%).
alter table charges add column if not exists coupon_code text;
alter table charges add column if not exists discount_cents int not null default 0;
alter table charges drop constraint if exists charges_amount_cents_check;
alter table charges drop constraint if exists charges_amount_nonneg;
alter table charges add constraint charges_amount_nonneg check (amount_cents >= 0);

-- ---------- regra do cupom (uso interno) ----------
-- Valida o cupom para aquele professor e calcula o desconto sobre p_base (centavos).
-- Lança erro em português se o cupom não puder ser usado.
create or replace function apply_coupon(p_uid uuid, p_code text, p_base int, p_lock boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_code text := upper(trim(coalesce(p_code, '')));
  disc int;
  cp coupons%rowtype;
begin
  if v_code = '' then
    return jsonb_build_object('coupon_id', null, 'coupon_code', null, 'discount_cents', 0);
  end if;
  if p_base <= 0 then raise exception 'Não há valor a cobrar para aplicar o cupom.'; end if;

  if p_lock then
    select * into cp from coupons c where c.code = v_code for update;
  else
    select * into cp from coupons c where c.code = v_code;
  end if;
  if not found or not cp.active then raise exception 'Cupom inválido.'; end if;
  if cp.expires_at is not null and cp.expires_at < today then raise exception 'Este cupom expirou.'; end if;
  if cp.max_uses is not null and (select count(*) from coupon_uses u where u.coupon_id = cp.id) >= cp.max_uses then
    raise exception 'Este cupom esgotou.';
  end if;
  if exists (select 1 from coupon_uses u where u.coupon_id = cp.id and u.teacher_id = p_uid) then
    raise exception 'Você já usou este cupom.';
  end if;

  disc := case cp.kind when 'percent' then p_base * cp.value / 100 else least(cp.value, p_base) end;
  return jsonb_build_object('coupon_id', cp.id, 'coupon_code', cp.code, 'discount_cents', disc);
end $$;
revoke execute on function apply_coupon(uuid, text, int, boolean) from public, anon, authenticated;

-- ---------- renovação: cotação ----------
create or replace function renewal_quote(p_uid uuid, p_code text, p_lock boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  first_next date := (date_trunc('month', today) + interval '1 month')::date;
  total int; per int; subtotal int;
  cq jsonb;
begin
  select count(*) into total from slots where teacher_id = p_uid and active;
  if total = 0 then raise exception 'Você ainda não tem horários para renovar.'; end if;
  per := price_per_slot(total);
  subtotal := total * per;
  cq := apply_coupon(p_uid, p_code, subtotal, p_lock);

  return jsonb_build_object(
    'count', total, 'per_slot_cents', per, 'subtotal_cents', subtotal,
    'discount_cents', (cq->>'discount_cents')::int,
    'total_cents', subtotal - (cq->>'discount_cents')::int,
    'cycle', to_char(first_next, 'YYYY-MM'),
    'coupon_code', cq->>'coupon_code', 'coupon_id', cq->>'coupon_id');
end $$;
revoke execute on function renewal_quote(uuid, text, boolean) from public, anon, authenticated;

create or replace function renewal_quote_me(p_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if not exists (select 1 from profiles where id = uid and role = 'teacher' and active) then
    raise exception 'Apenas professores podem renovar o plano.';
  end if;
  return renewal_quote(uid, p_code) - 'coupon_id';
end $$;
revoke execute on function renewal_quote_me(text) from public, anon;
grant execute on function renewal_quote_me(text) to authenticated;

-- ---------- renovar plano (cupom opcional) ----------
drop function if exists renew_plan();
create or replace function renew_plan(p_code text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tname text;
  q jsonb;
  n_cycle text;
  due_day date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '1 month')::date;
  new_charge uuid;
  tot int;
begin
  select name into tname from profiles where id = uid and role = 'teacher' and active;
  if tname is null then raise exception 'Apenas professores podem renovar o plano.'; end if;

  q := renewal_quote(uid, p_code, true);
  n_cycle := q->>'cycle';
  tot := (q->>'total_cents')::int;
  if exists (select 1 from charges where teacher_id = uid and cycle = n_cycle) then
    raise exception 'O plano do próximo mês já foi renovado.';
  end if;

  insert into charges (teacher_id, amount_cents, due_date, cycle, note, coupon_code, discount_cents, status, paid_at)
  values (uid, tot, due_day, n_cycle,
          'Renovação do plano' || coalesce(' · cupom ' || (q->>'coupon_code'), ''),
          q->>'coupon_code', (q->>'discount_cents')::int,
          case when tot = 0 then 'paid' else 'pending' end,
          case when tot = 0 then now() end)
  returning id into new_charge;

  if q->>'coupon_id' is not null then
    insert into coupon_uses (coupon_id, teacher_id, charge_id) values ((q->>'coupon_id')::uuid, uid, new_charge);
  end if;

  perform notify_admins('Plano renovado',
    tname || ' renovou o plano: ' || (q->>'count') || ' por semana, R$ ' || (tot / 100) || ' por mês'
      || coalesce(' (cupom ' || (q->>'coupon_code') || ')', '') || '.');

  return json_build_object('count', (q->>'count')::int, 'subtotal_cents', (q->>'subtotal_cents')::int,
                           'discount_cents', (q->>'discount_cents')::int, 'total_cents', tot, 'cycle', n_cycle);
end $$;
revoke execute on function renew_plan(text) from public, anon;
grant execute on function renew_plan(text) to authenticated;

-- ---------- fechamento de horários: cotação com cupom ----------
-- p_new = quantos horários novos o professor está selecionando.
create or replace function booking_quote_me(p_new int, p_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  total int; per int; due int; already int; gross int;
  cyc text := to_char((now() at time zone 'America/Sao_Paulo'), 'YYYY-MM');
  cq jsonb;
begin
  if not exists (select 1 from profiles where id = uid and role = 'teacher' and active) then
    raise exception 'Apenas professores podem usar cupom ao fechar horários.';
  end if;
  select count(*) + greatest(p_new, 0) into total from slots where teacher_id = uid and active;
  per := price_per_slot(total);
  due := total * per;
  select coalesce(sum(amount_cents + discount_cents), 0) into already from charges where teacher_id = uid and cycle = cyc;
  gross := greatest(due - already, 0);
  cq := apply_coupon(uid, p_code, gross);
  return jsonb_build_object(
    'count', total, 'per_slot_cents', per, 'monthly_cents', due, 'gross_cents', gross,
    'discount_cents', (cq->>'discount_cents')::int,
    'pay_cents', gross - (cq->>'discount_cents')::int,
    'coupon_code', cq->>'coupon_code');
end $$;
revoke execute on function booking_quote_me(int, text) from public, anon;
grant execute on function booking_quote_me(int, text) to authenticated;

-- ---------- book_slots com cupom ----------
-- p_teacher:      nulo = o professor logado fecha para si; o próprio admin = reserva da administração
--                 (sem custo); outro usuário = admin reservando para aquele professor.
-- p_amount_cents: só admin. Para professor: nulo = preço automático; valor = cobra exatamente isso (0 = não cobra).
--                 Para si mesmo: nulo = sem custo; valor = cobra esse valor.
-- p_coupon:       cupom opcional, só quando o professor fecha os próprios horários.
-- O preço automático e o desconto são sempre calculados aqui, nunca pelo app.
drop function if exists book_slots(jsonb, uuid, int, text);
create or replace function book_slots(
  p jsonb, p_teacher uuid default null, p_amount_cents int default null,
  p_note text default null, p_coupon text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target uuid;
  internal boolean := false;
  item jsonb;
  new_id uuid;
  new_charge uuid;
  tname text;
  aname text;
  total int;
  per int := 0;
  due int := 0;
  already int;
  diff int := 0;
  disc int := 0;
  cq jsonb;
  v_coupon text := upper(trim(coalesce(p_coupon, '')));
  added int := jsonb_array_length(p);
  cyc text := to_char(now(), 'YYYY-MM');
begin
  -- Valor manual e descrição são só dos administradores. Professor sempre paga a tabela.
  if (p_amount_cents is not null or p_note is not null) and not is_admin() then
    raise exception 'Apenas administradores podem definir valor ou descrição.';
  end if;
  -- Cupom: só o professor fechando os próprios horários.
  if v_coupon <> '' and p_teacher is not null then
    raise exception 'O cupom vale apenas quando o professor fecha os próprios horários.';
  end if;

  if p_teacher is null then
    target := uid;
  else
    if not is_admin() then
      raise exception 'Apenas administradores podem reservar para outra pessoa.';
    end if;
    target := p_teacher;
    internal := (p_teacher = uid);
  end if;

  if internal then
    select name into tname from profiles where id = target and role = 'admin' and active;
  else
    select name into tname from profiles where id = target and role = 'teacher' and active;
  end if;
  if tname is null then
    raise exception 'Apenas professores cadastrados podem ter horários.';
  end if;
  if p_amount_cents is not null and (p_amount_cents < 0 or p_amount_cents > 10000000) then
    raise exception 'Valor inválido.';
  end if;
  if added = 0 then raise exception 'Nenhum horário selecionado.'; end if;

  for item in select * from jsonb_array_elements(p) loop
    if (item->>'weekday')::int not between 1 and 6
       or (item->>'start')::time < time '09:00'
       or (item->>'start')::time > (case when (item->>'weekday')::int = 6 then time '17:00' else time '21:00' end)
       or extract(minute from (item->>'start')::time) <> 0 then
      raise exception 'Horário inválido.';
    end if;
    begin
      insert into slots (room_id, teacher_id, weekday, start_time, end_time)
      values ((item->>'room_id')::uuid, target, (item->>'weekday')::int,
              (item->>'start')::time, (item->>'start')::time + interval '1 hour')
      returning id into new_id;
      insert into slot_events (slot_id, kind, note, created_by)
      values (new_id, 'obs',
        case when p_teacher is null then 'Horário fechado.'
             when internal then 'Horário reservado pela administração (sem custo).'
             else 'Horário reservado pela administração.' end, uid);
    exception when unique_violation then
      raise exception 'Um dos horários acabou de ser ocupado. Atualize e escolha outro.';
    end;
  end loop;

  select count(*) into total from slots where teacher_id = target and active;

  if internal then
    diff := coalesce(p_amount_cents, 0);         -- administrador: sem custo, salvo valor preenchido por ele
  else
    per := price_per_slot(total);
    due := total * per;
    if p_amount_cents is not null then
      diff := p_amount_cents;                    -- valor manual definido pelo administrador
    else
      -- automático: só a diferença do mês (conta o valor cheio já cobrado, antes de descontos)
      select coalesce(sum(amount_cents + discount_cents), 0) into already from charges where teacher_id = target and cycle = cyc;
      diff := due - already;
    end if;
  end if;

  if diff > 0 then
    if v_coupon <> '' then
      cq := apply_coupon(target, v_coupon, diff, true);
      disc := (cq->>'discount_cents')::int;
    end if;
    insert into charges (teacher_id, amount_cents, due_date, cycle, note, coupon_code, discount_cents, status, paid_at)
    values (target, diff - disc, current_date + 5, cyc,
            left(nullif(trim(p_note), ''), 120),
            cq->>'coupon_code', disc,
            case when diff - disc = 0 then 'paid' else 'pending' end,
            case when diff - disc = 0 then now() end)
    returning id into new_charge;
    if cq->>'coupon_id' is not null then
      insert into coupon_uses (coupon_id, teacher_id, charge_id) values ((cq->>'coupon_id')::uuid, target, new_charge);
    end if;
  elsif v_coupon <> '' then
    raise exception 'Não há valor a cobrar para aplicar o cupom.';
  end if;

  -- avisos
  if p_teacher is null then
    perform notify_admins(
      'Novos horários fechados',
      tname || ' fechou ' || added || (case when added = 1 then ' horário' else ' horários' end)
        || '. Agora são ' || total || ' por semana: R$ ' || (due / 100) || ' por mês'
        || coalesce(' (cupom ' || (cq->>'coupon_code') || ')', '') || '.');
  else
    select name into aname from profiles where id = uid;
    if internal then
      perform notify_admins(
        'Horários da administração',
        aname || ' reservou ' || added || (case when added = 1 then ' horário' else ' horários' end)
          || ' para si' || (case when diff > 0 then ', com cobrança de R$ ' || (diff / 100) else ', sem custo' end) || '.', uid);
    else
      perform notify_admins(
        'Horários reservados',
        aname || ' reservou ' || added || (case when added = 1 then ' horário' else ' horários' end)
          || ' para ' || tname || '. Agora são ' || total || ' por semana.', uid);
      perform notify_user(target, 'Horários reservados',
        'A Lyrics reservou ' || added || (case when added = 1 then ' horário' else ' horários' end)
          || ' para você. Confira na sua agenda.');
    end if;
  end if;

  return json_build_object('count', total, 'per_slot_cents', per, 'total_cents', due,
                           'charged_cents', greatest(diff - disc, 0), 'discount_cents', disc,
                           'coupon_code', cq->>'coupon_code', 'internal', internal);
end $$;

revoke execute on function book_slots(jsonb, uuid, int, text, text) from public, anon;
grant execute on function book_slots(jsonb, uuid, int, text, text) to authenticated;

-- Lyrics Hub — alunos, histórico dos alunos e relatório semanal de aulas.
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o inicio.sql e o cupons.sql)
--
-- Cada professor (e cada administrador que dá aula) cadastra os próprios alunos.
-- Administradores também enxergam os alunos de todos, mas só editam os próprios.

-- ---------- alunos ----------
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  phone text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Anotações livres sobre o aluno (evolução, repertório, observações).
create table if not exists student_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  owner_id uuid not null references profiles(id) default auth.uid(),
  note text not null check (char_length(trim(note)) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table students enable row level security;
alter table student_notes enable row level security;
drop policy if exists students_owner on students;
drop policy if exists students_admin_read on students;
drop policy if exists notes_owner on student_notes;
drop policy if exists notes_admin_read on student_notes;
create policy students_owner on students for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy students_admin_read on students for select using (is_admin());
create policy notes_owner on student_notes for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and exists (select 1 from students s where s.id = student_id and s.owner_id = auth.uid()));
create policy notes_admin_read on student_notes for select using (is_admin());

grant select, insert, update, delete on students, student_notes to authenticated;
grant all on students, student_notes to service_role;

-- ---------- ligação com horários e histórico ----------
alter table slots add column if not exists student_id uuid references students(id) on delete set null;
alter table slot_events add column if not exists student_id uuid references students(id) on delete set null;
-- Dia em que a aula aconteceu (padrão: hoje, no horário de São Paulo).
alter table slot_events add column if not exists lesson_date date not null default ((now() at time zone 'America/Sao_Paulo')::date);

-- Todo registro de aula/falta já nasce ligado ao aluno que estava no horário.
create or replace function slot_events_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.student_id is null then
    select student_id into new.student_id from slots where id = new.slot_id;
  end if;
  return new;
end $$;
drop trigger if exists slot_events_fill_trg on slot_events;
create trigger slot_events_fill_trg before insert on slot_events for each row execute function slot_events_fill();

-- Renomear o aluno atualiza o nome mostrado nos horários.
create or replace function students_sync_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    update slots set student = new.name where student_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists students_sync_name_trg on students;
create trigger students_sync_name_trg after update of name on students for each row execute function students_sync_name();

-- Escolher (ou tirar) o aluno de um horário. Substitui a versão antiga, que recebia texto livre.
drop function if exists set_slot_student(uuid, text);
create or replace function set_slot_student(p_slot uuid, p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  towner uuid;
  sname text;
begin
  select teacher_id into towner from slots where id = p_slot;
  if towner is null or (towner <> auth.uid() and not is_admin()) then
    raise exception 'Horário não encontrado.';
  end if;
  if p_student is not null then
    select name into sname from students where id = p_student and owner_id = towner and active;
    if sname is null then raise exception 'Aluno não encontrado.'; end if;
  end if;
  update slots set student_id = p_student, student = sname where id = p_slot;
end $$;
revoke execute on function set_slot_student(uuid, uuid) from public, anon;
grant execute on function set_slot_student(uuid, uuid) to authenticated;

-- Arquivar o aluno: sai da lista e dos horários; o histórico continua guardado.
create or replace function archive_student(p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update students set active = false where id = p_student and owner_id = auth.uid();
  if not found then raise exception 'Aluno não encontrado.'; end if;
  update slots set student_id = null, student = null where student_id = p_student;
end $$;
revoke execute on function archive_student(uuid) from public, anon;
grant execute on function archive_student(uuid) to authenticated;

-- ---------- relatório semanal ----------
-- Para a semana (segunda a domingo) que contém p_week_start: cada aula prevista dos horários
-- da pessoa logada, com o que foi registrado ('aula', 'falta' ou nada ainda).
create or replace function weekly_report(p_week_start date) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ws date := date_trunc('week', p_week_start)::date;
begin
  if not exists (select 1 from profiles where id = uid and active) then raise exception 'Sem acesso.'; end if;
  return coalesce((
    select json_agg(r order by r.lesson_date, r.start) from (
      select d::date as lesson_date, s.weekday, to_char(s.start_time, 'HH24:MI') as start,
             s.id as slot_id, s.student, s.student_id, e.kind as status, e.note
      from slots s
      cross join generate_series(ws, ws + 6, interval '1 day') d
      left join lateral (
        select ev.kind, ev.note from slot_events ev
        where ev.slot_id = s.id and ev.lesson_date = d::date and ev.kind in ('aula', 'falta')
        order by ev.created_at desc limit 1) e on true
      where s.teacher_id = uid and s.active
        and extract(dow from d)::int = s.weekday
        and d::date >= (s.created_at at time zone 'America/Sao_Paulo')::date
    ) r), '[]'::json);
end $$;
revoke execute on function weekly_report(date) from public, anon;
grant execute on function weekly_report(date) to authenticated;

-- ---------- painéis: o número de alunos agora vem do cadastro ----------
create or replace function my_dashboard() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  m_start date := date_trunc('month', today)::date;
  m_end date := (date_trunc('month', today) + interval '1 month')::date;
  n_cycle text := to_char((date_trunc('month', today) + interval '1 month'), 'YYYY-MM');
  planned int; done int; missed int; students_n int; total int; renewed boolean;
  slots_json json;
begin
  if not exists (select 1 from profiles where id = uid and active) then
    raise exception 'Sem acesso.';
  end if;

  select count(*) into planned
  from slots s,
       generate_series(greatest(m_start, (s.created_at at time zone 'America/Sao_Paulo')::date), m_end - 1, interval '1 day') d
  where s.teacher_id = uid and s.active and extract(dow from d)::int = s.weekday;

  select count(*) filter (where e.kind = 'aula'), count(*) filter (where e.kind = 'falta')
    into done, missed
  from slot_events e join slots s on s.id = e.slot_id
  where s.teacher_id = uid and e.lesson_date >= m_start and e.lesson_date < m_end;

  select count(*) into students_n from students where owner_id = uid and active;
  select count(*) into total from slots where teacher_id = uid and active;

  select json_agg(json_build_object('id', id, 'weekday', weekday,
                                    'start', to_char(start_time, 'HH24:MI'), 'student', student)
                  order by weekday, start_time)
    into slots_json
  from slots where teacher_id = uid and active;

  renewed := exists (select 1 from charges where teacher_id = uid and cycle = n_cycle);

  return json_build_object(
    'month', to_char(today, 'YYYY-MM'), 'planned', planned, 'done', done, 'missed', missed,
    'students', students_n, 'slots', coalesce(slots_json, '[]'::json),
    'renewed', renewed, 'next_cycle', n_cycle, 'next_cents', total * price_per_slot(total));
end $$;

create or replace function admin_dashboard() returns json
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  m_start date := date_trunc('month', today)::date;
  m_end date := (date_trunc('month', today) + interval '1 month')::date;
  capacity int;
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  select count(*) * 74 into capacity from rooms;
  return json_build_object(
    'capacity', capacity,
    'occupied', (select count(*) from slots where active),
    'teachers', (select count(*) from profiles where role = 'teacher' and active),
    'students', (select count(*) from students where active),
    'received_cents', (select coalesce(sum(amount_cents), 0) from charges
                       where status = 'paid' and paid_at >= m_start and paid_at < m_end),
    'pending_cents', (select coalesce(sum(amount_cents), 0) from charges where status <> 'paid'),
    'done_month', (select count(*) from slot_events where kind = 'aula' and lesson_date >= m_start and lesson_date < m_end),
    'by_weekday', (select json_agg(c order by d) from (
        select g.d, (select count(*) from slots s where s.active and s.weekday = g.d) c
        from generate_series(0, 6) as g(d)) x),
    'today', coalesce((select json_agg(json_build_object(
        'start', to_char(s.start_time, 'HH24:MI'), 'teacher', p.name, 'student', s.student) order by s.start_time)
      from slots s join profiles p on p.id = s.teacher_id
      where s.active and s.weekday = extract(dow from today)::int), '[]'::json));
end $$;
-- Lyrics Hub — a única notificação do app: lembrete de aula ao professor.
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o notificacoes.sql)
--
-- 1) O lembrete passa a dizer só que há aula naquele horário (sem nome de aluno).
-- 2) Todos os outros avisos (a administradores e ao professor) ficam desligados.

create or replace function send_lesson_reminders(
  p_now timestamp default (now() at time zone 'America/Sao_Paulo')
) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  msgs jsonb;
begin
  delete from reminders_sent where day < p_now::date - 7;

  with due as (select * from due_reminders(p_now)),
       marked as (insert into reminders_sent (slot_id, day) select slot_id, day from due returning slot_id)
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'sound', 'default',
           'title', 'Aula hoje',
           'body', 'Hoje você tem aula às ' || to_char(d.start_time, 'HH24:MI') || '.'))
    into msgs
  from due d
  join marked m on m.slot_id = d.slot_id
  join push_tokens t on t.user_id = d.teacher_id;

  if msgs is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := msgs);
  end if;
  return coalesce(jsonb_array_length(msgs), 0);
end $$;
revoke execute on function send_lesson_reminders(timestamp) from public, anon, authenticated;

-- Avisos desligados. As funções continuam existindo (as reservas e renovações ainda as chamam),
-- mas agora não enviam nada.
create or replace function notify_admins(p_title text, p_body text, p_exclude uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  null;
end $$;
revoke execute on function notify_admins(text, text, uuid) from public, anon, authenticated;

create or replace function notify_user(p_user uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  null;
end $$;
revoke execute on function notify_user(uuid, text, text) from public, anon, authenticated;

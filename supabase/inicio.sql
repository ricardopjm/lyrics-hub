-- Lyrics Hub — página inicial (resumo) e renovação do plano.
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o notificacoes.sql e o admin-reservas.sql)

-- Data em que o horário foi fechado: usada para contar as aulas previstas do mês.
alter table slots add column if not exists created_at timestamptz not null default now();

-- ---------- resumo do professor ----------
create or replace function my_dashboard() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  m_start date := date_trunc('month', today)::date;
  m_end date := (date_trunc('month', today) + interval '1 month')::date;
  n_cycle text := to_char((date_trunc('month', today) + interval '1 month'), 'YYYY-MM');
  planned int; done int; missed int; students int; total int; renewed boolean;
  slots_json json;
begin
  if not exists (select 1 from profiles where id = uid and active) then
    raise exception 'Sem acesso.';
  end if;

  -- aulas previstas no mês: cada ocorrência do dia da semana de cada horário, desde que o horário foi fechado
  select count(*) into planned
  from slots s,
       generate_series(greatest(m_start, (s.created_at at time zone 'America/Sao_Paulo')::date), m_end - 1, interval '1 day') d
  where s.teacher_id = uid and s.active and extract(dow from d)::int = s.weekday;

  select count(*) filter (where e.kind = 'aula'), count(*) filter (where e.kind = 'falta')
    into done, missed
  from slot_events e join slots s on s.id = e.slot_id
  where s.teacher_id = uid and e.created_at >= m_start and e.created_at < m_end;

  select count(distinct nullif(trim(student), '')), count(*) into students, total
  from slots where teacher_id = uid and active;

  select json_agg(json_build_object('id', id, 'weekday', weekday,
                                    'start', to_char(start_time, 'HH24:MI'), 'student', student)
                  order by weekday, start_time)
    into slots_json
  from slots where teacher_id = uid and active;

  renewed := exists (select 1 from charges where teacher_id = uid and cycle = n_cycle);

  return json_build_object(
    'month', to_char(today, 'YYYY-MM'), 'planned', planned, 'done', done, 'missed', missed,
    'students', students, 'slots', coalesce(slots_json, '[]'::json),
    'renewed', renewed, 'next_cycle', n_cycle, 'next_cents', total * price_per_slot(total));
end $$;

-- ---------- resumo da administração ----------
create or replace function admin_dashboard() returns json
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  m_start date := date_trunc('month', today)::date;
  m_end date := (date_trunc('month', today) + interval '1 month')::date;
  capacity int;
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;

  -- 5 dias de 13 horas (9h às 22h) + sábado de 9 horas (9h às 18h), por sala
  select count(*) * 74 into capacity from rooms;

  return json_build_object(
    'capacity', capacity,
    'occupied', (select count(*) from slots where active),
    'teachers', (select count(*) from profiles where role = 'teacher' and active),
    'students', (select count(distinct nullif(trim(student), '')) from slots where active),
    'received_cents', (select coalesce(sum(amount_cents), 0) from charges
                       where status = 'paid' and paid_at >= m_start and paid_at < m_end),
    'pending_cents', (select coalesce(sum(amount_cents), 0) from charges where status <> 'paid'),
    'done_month', (select count(*) from slot_events where kind = 'aula' and created_at >= m_start and created_at < m_end),
    'by_weekday', (select json_agg(c order by d) from (
        select g.d, (select count(*) from slots s where s.active and s.weekday = g.d) c
        from generate_series(0, 6) as g(d)) x),
    'today', coalesce((select json_agg(json_build_object(
        'start', to_char(s.start_time, 'HH24:MI'), 'teacher', p.name, 'student', s.student) order by s.start_time)
      from slots s join profiles p on p.id = s.teacher_id
      where s.active and s.weekday = extract(dow from today)::int), '[]'::json));
end $$;

-- ---------- renovar plano ----------
-- Gera a cobrança do próximo mês com os horários atuais, pela tabela de preços.
create or replace function renew_plan() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  first_next date := (date_trunc('month', today) + interval '1 month')::date;
  n_cycle text := to_char(first_next, 'YYYY-MM');
  tname text;
  total int; per int; due int;
begin
  select name into tname from profiles where id = uid and role = 'teacher' and active;
  if tname is null then raise exception 'Apenas professores podem renovar o plano.'; end if;

  select count(*) into total from slots where teacher_id = uid and active;
  if total = 0 then raise exception 'Você ainda não tem horários para renovar.'; end if;
  if exists (select 1 from charges where teacher_id = uid and cycle = n_cycle) then
    raise exception 'O plano do próximo mês já foi renovado.';
  end if;

  per := price_per_slot(total);
  due := total * per;
  insert into charges (teacher_id, amount_cents, due_date, cycle, note)
  values (uid, due, first_next, n_cycle, 'Renovação do plano');

  perform notify_admins('Plano renovado',
    tname || ' renovou o plano: ' || total || ' por semana, R$ ' || (due / 100) || ' por mês.');

  return json_build_object('count', total, 'per_slot_cents', per, 'total_cents', due, 'cycle', n_cycle);
end $$;

revoke execute on function my_dashboard(), admin_dashboard(), renew_plan() from public, anon;
grant execute on function my_dashboard(), admin_dashboard(), renew_plan() to authenticated;

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
-- Registros antigos: usa o dia em que foram lançados.
update slot_events set lesson_date = (created_at at time zone 'America/Sao_Paulo')::date;

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

-- Lyrics Hub — notificações
-- Rode este arquivo inteiro em: Supabase > SQL Editor > New query > Run
--
-- O que ele faz:
--  1. Lembrete ao professor ~5 horas antes de cada aula (checa a cada 10 minutos, 1 aviso por aula por dia).
--  2. Aviso aos administradores quando um professor fecha horários.
--  3. Registro do celular de cada usuário para receber os avisos.
--  4. Permite ao professor informar o nome do aluno de cada horário.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Controle para não avisar duas vezes a mesma aula no mesmo dia.
create table if not exists reminders_sent (
  slot_id uuid not null references slots(id) on delete cascade,
  day date not null,
  primary key (slot_id, day)
);
alter table reminders_sent enable row level security; -- sem políticas: ninguém acessa pelo app

-- ---------- celular do usuário ----------
create or replace function register_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  insert into push_tokens (user_id, token) values (auth.uid(), p_token)
  on conflict (token) do update set user_id = auth.uid();
end $$;

create or replace function unregister_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from push_tokens where token = p_token and user_id = auth.uid();
end $$;

revoke execute on function register_push_token(text), unregister_push_token(text) from public, anon;
grant execute on function register_push_token(text), unregister_push_token(text) to authenticated;

-- ---------- nome do aluno no horário ----------
create or replace function set_slot_student(p_slot uuid, p_student text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slots set student = left(nullif(trim(p_student), ''), 80)
  where id = p_slot and (teacher_id = auth.uid() or is_admin());
  if not found then raise exception 'Horário não encontrado.'; end if;
end $$;

revoke execute on function set_slot_student(uuid, text) from public, anon;
grant execute on function set_slot_student(uuid, text) to authenticated;

-- ---------- lembretes ----------
-- Aulas de hoje que começam dentro de até 5 horas e ainda não foram avisadas.
-- p_now é a hora local de São Paulo.
create or replace function due_reminders(p_now timestamp)
returns table (slot_id uuid, teacher_id uuid, teacher_name text, start_time time, student text, day date)
language sql stable security definer set search_path = public as $$
  select s.id, s.teacher_id, p.name, s.start_time, s.student, p_now::date
  from slots s
  join profiles p on p.id = s.teacher_id and p.active
  where s.active
    and s.weekday = extract(dow from p_now)::int
    and s.start_time > p_now::time
    and (s.start_time - p_now::time) <= interval '5 hours'
    and not exists (select 1 from reminders_sent r where r.slot_id = s.id and r.day = p_now::date)
$$;

-- Envia os lembretes pelo serviço de push da Expo. Chamada pelo agendador a cada 10 minutos.
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
           'body', case when coalesce(d.student, '') <> ''
                        then 'Hoje você tem aula com ' || d.student || ' às ' || to_char(d.start_time, 'HH24:MI') || '.'
                        else 'Hoje você tem aula às ' || to_char(d.start_time, 'HH24:MI') || '.' end))
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

revoke execute on function send_lesson_reminders(timestamp), due_reminders(timestamp) from public, anon, authenticated;

-- Prévia para administradores: quais lembretes sairiam em determinado horário (não envia nada).
create or replace function preview_reminders(
  p_now timestamp default (now() at time zone 'America/Sao_Paulo')
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'professor', teacher_name, 'hora', to_char(start_time, 'HH24:MI'), 'aluno', student))
    from due_reminders(p_now)), '[]'::jsonb);
end $$;

revoke execute on function preview_reminders(timestamp) from public, anon;
grant execute on function preview_reminders(timestamp) to authenticated;

-- ---------- aviso aos administradores ----------
create or replace function notify_admins(p_title text, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', t.token, 'sound', 'default', 'title', p_title, 'body', p_body))
    into msgs
  from push_tokens t join profiles p on p.id = t.user_id
  where p.role = 'admin' and p.active;

  if msgs is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := msgs);
  end if;
end $$;

revoke execute on function notify_admins(text, text) from public, anon, authenticated;

-- book_slots atualizada: agora avisa os administradores quando o professor fecha horários.
create or replace function book_slots(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  new_id uuid;
  tname text;
  total int;
  per int;
  due int;
  already int;
  diff int;
  added int := jsonb_array_length(p);
  cyc text := to_char(now(), 'YYYY-MM');
begin
  select name into tname from profiles where id = uid and role = 'teacher' and active;
  if tname is null then
    raise exception 'Apenas professores cadastrados podem fechar horários.';
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

  perform notify_admins(
    'Novos horários fechados',
    tname || ' fechou ' || added || (case when added = 1 then ' horário' else ' horários' end)
      || '. Agora são ' || total || ' por semana: R$ ' || (due / 100) || ' por mês.');

  return json_build_object('count', total, 'per_slot_cents', per, 'total_cents', due, 'charged_cents', greatest(diff, 0));
end $$;
grant execute on function book_slots(jsonb) to authenticated;

-- ---------- agendamento: a cada 10 minutos ----------
select cron.unschedule('lesson-reminders') where exists (select 1 from cron.job where jobname = 'lesson-reminders');
select cron.schedule('lesson-reminders', '*/10 * * * *', 'select public.send_lesson_reminders()');

-- Conferência: deve listar o agendamento 'lesson-reminders'.
select jobname, schedule, active from cron.job where jobname = 'lesson-reminders';

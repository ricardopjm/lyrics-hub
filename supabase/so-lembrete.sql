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

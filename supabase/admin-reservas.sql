-- Lyrics Hub — administradores podem reservar horários.
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o notificacoes.sql)
--
-- Três jeitos de reservar:
--  1. Professor, para si mesmo: preço automático pela faixa.
--  2. Administrador para si mesmo (também dá aulas): sem custo, a menos que ele preencha um valor.
--  3. Administrador para um professor: preço automático, ou um valor manual (inclusive R$ 0).

-- Descrição opcional da cobrança (por exemplo: "Evento de lançamento").
alter table charges add column if not exists note text;

drop function if exists book_slots(jsonb);
drop function if exists book_slots(jsonb, uuid, int);
drop function if exists book_slots(jsonb, uuid, int, text);
drop function if exists book_slots(jsonb, uuid);
drop function if exists notify_admins(text, text);

create or replace function notify_admins(p_title text, p_body text, p_exclude uuid default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', t.token, 'sound', 'default', 'title', p_title, 'body', p_body))
    into msgs
  from push_tokens t join profiles p on p.id = t.user_id
  where p.role = 'admin' and p.active and (p_exclude is null or p.id <> p_exclude);

  if msgs is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := msgs);
  end if;
end $$;
revoke execute on function notify_admins(text, text, uuid) from public, anon, authenticated;

create or replace function notify_user(p_user uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', token, 'sound', 'default', 'title', p_title, 'body', p_body))
    into msgs from push_tokens where user_id = p_user;
  if msgs is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := msgs);
  end if;
end $$;
revoke execute on function notify_user(uuid, text, text) from public, anon, authenticated;

-- p_teacher:
--   nulo ............ o professor logado reserva para si
--   o próprio admin . reserva da administração (sem custo)
--   outro usuário ... admin reservando para aquele professor
-- p_amount_cents: só admin. Para professor: nulo = preço automático; preenchido = cobra exatamente
--   esse valor por esta reserva (0 = não cobra). Para si mesmo: nulo = sem custo; preenchido = cobra esse valor.
-- O preço automático é sempre calculado aqui, nunca pelo app.
create function book_slots(p jsonb, p_teacher uuid default null, p_amount_cents int default null, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target uuid;
  internal boolean := false;
  item jsonb;
  new_id uuid;
  tname text;
  aname text;
  total int;
  per int := 0;
  due int := 0;
  already int;
  diff int := 0;
  added int := jsonb_array_length(p);
  cyc text := to_char(now(), 'YYYY-MM');
begin
  -- Valor manual e descrição são só dos administradores. Professor sempre paga a tabela.
  if (p_amount_cents is not null or p_note is not null) and not is_admin() then
    raise exception 'Apenas administradores podem definir valor ou descrição.';
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
      select coalesce(sum(amount_cents), 0) into already from charges where teacher_id = target and cycle = cyc;
      diff := due - already;                     -- automático: só a diferença do mês
    end if;
  end if;
  if diff > 0 then
    insert into charges (teacher_id, amount_cents, due_date, cycle, note)
    values (target, diff, current_date + 5, cyc, left(nullif(trim(p_note), ''), 120));
  end if;

  -- avisos
  if p_teacher is null then
    perform notify_admins(
      'Novos horários fechados',
      tname || ' fechou ' || added || (case when added = 1 then ' horário' else ' horários' end)
        || '. Agora são ' || total || ' por semana: R$ ' || (due / 100) || ' por mês.');
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
                           'charged_cents', greatest(diff, 0), 'internal', internal);
end $$;

revoke execute on function book_slots(jsonb, uuid, int, text) from public, anon;
grant execute on function book_slots(jsonb, uuid, int, text) to authenticated;

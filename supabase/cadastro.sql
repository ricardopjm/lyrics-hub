-- Lyrics Hub — professor novo se cadastra sozinho e só ganha acesso quando o pagamento é confirmado;
-- plano vencido não apaga a conta.
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o pendentes.sql e o corrigir-acentos.sql)
--
-- Fluxo do cadastro:
--  1. O visitante escolhe horários e informa nome, e-mail e senha (função "signup-teacher").
--  2. A conta nasce INATIVA ("pending_signup"). Os horários ficam reservados e o pedido aparece na fila do admin.
--  3. O admin confirma o pagamento -> a conta é ativada. Se recusar (ou ninguém pagar em 3 dias), os horários são liberados.
--
-- Plano vencido: os horários são liberados, mas a conta, os alunos e todo o histórico continuam.
-- O professor contrata um novo plano pelo próprio app.

alter table profiles add column if not exists pending_signup boolean not null default false;
-- Último dia pago do plano. Vazio = professor gerenciado só pelo admin (nunca vence sozinho).
alter table profiles add column if not exists plan_until date;
-- Quando o horário deixou de valer (plano vencido). Mantém o histórico das semanas passadas no relatório.
alter table slots add column if not exists ended_at timestamptz;

-- Cobranças criadas pelo servidor (sem usuário logado) mantêm a origem informada.
create or replace function charges_set_origin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.origin := case when is_admin() then 'admin' else 'teacher' end;
  end if;
  return new;
end $$;

-- ---------- uso interno da função pública de cadastro ----------
-- Cotação com cupom para quem ainda não tem conta.
create or replace function signup_quote(p_count int, p_code text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  per int; gross int; cq jsonb;
begin
  if p_count is null or p_count < 1 or p_count > 20 then raise exception 'Escolha de 1 a 20 horários.'; end if;
  per := price_per_slot(p_count);
  gross := p_count * per;
  cq := apply_coupon(null::uuid, p_code, gross);
  return jsonb_build_object(
    'count', p_count, 'per_slot_cents', per, 'gross_cents', gross,
    'discount_cents', (cq->>'discount_cents')::int,
    'pay_cents', gross - (cq->>'discount_cents')::int,
    'coupon_code', cq->>'coupon_code');
end $$;
revoke execute on function signup_quote(int, text) from public, anon, authenticated;
grant execute on function signup_quote(int, text) to service_role;

-- Reserva os horários e cria o pedido do professor novo (a conta já existe, inativa).
create or replace function signup_order(p_user uuid, p_slots jsonb, p_coupon text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  new_id uuid;
  new_charge uuid;
  total int; per int; due int; disc int := 0;
  cq jsonb;
  v_coupon text := upper(trim(coalesce(p_coupon, '')));
  cyc text := to_char(now(), 'YYYY-MM');
begin
  if not exists (select 1 from profiles where id = p_user and role = 'teacher' and pending_signup) then
    raise exception 'Cadastro não encontrado.';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) not between 1 and 20 then
    raise exception 'Escolha de 1 a 20 horários.';
  end if;

  for item in select * from jsonb_array_elements(p_slots) loop
    if (item->>'weekday')::int not between 1 and 6
       or (item->>'start')::time < time '09:00'
       or (item->>'start')::time > (case when (item->>'weekday')::int = 6 then time '17:00' else time '21:00' end)
       or extract(minute from (item->>'start')::time) <> 0 then
      raise exception 'Horário inválido.';
    end if;
    begin
      insert into slots (room_id, teacher_id, weekday, start_time, end_time)
      values ((item->>'room_id')::uuid, p_user, (item->>'weekday')::int,
              (item->>'start')::time, (item->>'start')::time + interval '1 hour')
      returning id into new_id;
      insert into slot_events (slot_id, kind, note, created_by)
      values (new_id, 'obs', 'Horário fechado no cadastro.', p_user);
    exception when unique_violation then
      raise exception 'Um dos horários acabou de ser ocupado. Atualize e escolha outro.';
    end;
  end loop;

  select count(*) into total from slots where teacher_id = p_user and active;
  per := price_per_slot(total);
  due := total * per;
  if v_coupon <> '' then
    cq := apply_coupon(p_user, v_coupon, due, true);
    disc := (cq->>'discount_cents')::int;
  end if;

  -- Sempre pendente: o administrador precisa liberar o cadastro, mesmo com cupom de 100%.
  insert into charges (teacher_id, amount_cents, due_date, cycle, coupon_code, discount_cents, status, origin)
  values (p_user, due - disc, current_date + 5, cyc, cq->>'coupon_code', disc, 'pending', 'teacher')
  returning id into new_charge;
  if cq->>'coupon_id' is not null then
    insert into coupon_uses (coupon_id, teacher_id, charge_id) values ((cq->>'coupon_id')::uuid, p_user, new_charge);
  end if;

  return jsonb_build_object('count', total, 'per_slot_cents', per, 'total_cents', due,
                            'charged_cents', due - disc, 'discount_cents', disc, 'coupon_code', cq->>'coupon_code');
end $$;
revoke execute on function signup_order(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function signup_order(uuid, jsonb, text) to service_role;

-- ---------- fila do administrador (agora com os dados do professor novo) ----------
create or replace function pending_orders() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  return coalesce((
    select json_agg(o order by o.created_at) from (
      select c.id, p.name as teacher, p.email, p.phone, p.pending_signup as signup,
             c.amount_cents, c.discount_cents, c.coupon_code, c.note, c.created_at, c.cycle,
             case when c.note like 'Renovação do plano%' then 'renovacao' else 'novo' end as kind,
             coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'))
                                       order by s.weekday, s.start_time)
                       from slots s
                       where s.teacher_id = c.teacher_id and s.created_at = c.created_at and s.active), '[]'::json) as slots
      from charges c join profiles p on p.id = c.teacher_id
      where c.origin = 'teacher' and c.status = 'pending'
    ) o), '[]'::json);
end $$;

-- Confirma o pagamento: a cobrança vira "Recebido", o cadastro novo é ATIVADO e o plano passa a valer até o fim do mês pago.
create or replace function confirm_order(p_charge uuid, p_method text default 'pix') returns void
language plpgsql security definer set search_path = public as $$
declare
  c charges%rowtype;
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  if p_method not in ('pix', 'machine') then raise exception 'Forma de pagamento inválida.'; end if;
  update charges set status = 'paid', method = p_method, paid_at = now()
  where id = p_charge and status = 'pending'
  returning * into c;
  if not found then raise exception 'Pedido não encontrado ou já confirmado.'; end if;

  update profiles set active = true, pending_signup = false where id = c.teacher_id and pending_signup;
  update profiles
     set plan_until = greatest(coalesce(plan_until, date '1970-01-01'),
                               (to_date(c.cycle || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date)
   where id = c.teacher_id and c.origin = 'teacher';
end $$;

-- Recusa o pedido: apaga os horários desse pedido, devolve o cupom e remove a cobrança.
-- Um cadastro novo continua inativo (o professor pode tentar de novo depois).
create or replace function reject_order(p_charge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c charges%rowtype;
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  select * into c from charges where id = p_charge and origin = 'teacher' and status = 'pending' for update;
  if not found then raise exception 'Pedido não encontrado ou já confirmado.'; end if;

  delete from slots where teacher_id = c.teacher_id and created_at = c.created_at;
  delete from coupon_uses where charge_id = c.id;
  delete from charges where id = c.id;
  update profiles set pending_signup = false where id = c.teacher_id and pending_signup;
end $$;

-- ---------- vencimento do plano ----------
-- Libera os horários de quem passou do último dia pago (a conta e o histórico ficam) e
-- cancela cadastros novos que ninguém pagou em 3 dias. Roda todo dia à noite; o admin também pode chamar.
create or replace function expire_plans() returns json
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  n_slots int; n_orders int;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'Apenas administradores.'; end if;

  with ended as (
    update slots set active = false, ended_at = now()
    where active and teacher_id in (select id from profiles where role = 'teacher' and plan_until is not null and plan_until < today)
    returning 1)
  select count(*) into n_slots from ended;

  with old as (
    select c.id, c.teacher_id, c.created_at from charges c join profiles p on p.id = c.teacher_id
    where c.origin = 'teacher' and c.status = 'pending' and p.pending_signup and c.created_at < now() - interval '3 days'),
  del_slots as (delete from slots where (teacher_id, created_at) in (select teacher_id, created_at from old) returning 1),
  del_uses as (delete from coupon_uses where charge_id in (select id from old) returning 1),
  del_charges as (delete from charges where id in (select id from old) returning teacher_id),
  upd as (update profiles set pending_signup = false where id in (select teacher_id from del_charges) returning 1)
  select count(*) into n_orders from del_charges;

  return json_build_object('horarios_liberados', n_slots, 'cadastros_cancelados', n_orders);
end $$;
revoke execute on function expire_plans() from public, anon;
grant execute on function expire_plans() to authenticated;

select cron.unschedule('expire-plans') where exists (select 1 from cron.job where jobname = 'expire-plans');
select cron.schedule('expire-plans', '10 3 * * *', 'select public.expire_plans()');

-- Situação do plano do professor logado (para o botão "Contratar novo plano").
create or replace function my_plan() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  pu date;
begin
  select plan_until into pu from profiles where id = uid;
  return json_build_object('plan_until', pu,
                           'expired', pu is not null and pu < today,
                           'has_slots', exists (select 1 from slots where teacher_id = uid and active));
end $$;
revoke execute on function my_plan() from public, anon;
grant execute on function my_plan() to authenticated;

-- ---------- relatório semanal: semanas passadas continuam mesmo depois do vencimento ----------
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
      where s.teacher_id = uid and (s.active or s.ended_at is not null)
        and extract(dow from d)::int = s.weekday
        and d::date >= (s.created_at at time zone 'America/Sao_Paulo')::date
        and (s.ended_at is null or d::date <= (s.ended_at at time zone 'America/Sao_Paulo')::date)
    ) r), '[]'::json);
end $$;

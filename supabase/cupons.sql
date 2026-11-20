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

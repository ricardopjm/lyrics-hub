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
-- Lyrics Hub — pedidos dos professores aguardam a confirmação do pagamento pelo administrador.
-- Rode em: Supabase > SQL Editor > New query > Run
-- (precisa ter rodado antes o cupons.sql)
--
-- Fluxo: o professor faz o pedido (fechar horários ou renovar) -> a cobrança fica PENDENTE e
-- aparece na fila do administrador. Só quando o administrador confirma o pagamento ela vira
-- "Recebido" no Financeiro. Se recusar, os horários do pedido voltam a ficar livres.

-- Quando a cobrança foi criada (também liga o pedido aos horários criados na mesma operação).
alter table charges add column if not exists created_at timestamptz not null default now();
-- Quem originou: 'teacher' = pedido do professor (precisa de confirmação); 'admin' = lançada pelo administrador.
alter table charges add column if not exists origin text not null default 'admin';
alter table charges drop constraint if exists charges_origin_check;
alter table charges add constraint charges_origin_check check (origin in ('teacher', 'admin'));

create or replace function charges_set_origin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.origin := case when auth.uid() is null or is_admin() then 'admin' else 'teacher' end;
  return new;
end $$;
drop trigger if exists charges_set_origin_trg on charges;
create trigger charges_set_origin_trg before insert on charges for each row execute function charges_set_origin();

-- ---------- fila do administrador ----------
create or replace function pending_orders() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  return coalesce((
    select json_agg(o order by o.created_at) from (
      select c.id, p.name as teacher, c.amount_cents, c.discount_cents, c.coupon_code, c.note,
             c.created_at, c.cycle,
             case when c.note like 'Renovação do plano%' then 'renovacao' else 'novo' end as kind,
             coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'))
                                       order by s.weekday, s.start_time)
                       from slots s
                       where s.teacher_id = c.teacher_id and s.created_at = c.created_at and s.active), '[]'::json) as slots
      from charges c join profiles p on p.id = c.teacher_id
      where c.origin = 'teacher' and c.status = 'pending'
    ) o), '[]'::json);
end $$;
revoke execute on function pending_orders() from public, anon;
grant execute on function pending_orders() to authenticated;

-- Confirma que o pagamento caiu: a cobrança vira "Recebido" e entra no Financeiro.
create or replace function confirm_order(p_charge uuid, p_method text default 'pix') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  if p_method not in ('pix', 'machine') then raise exception 'Forma de pagamento inválida.'; end if;
  update charges set status = 'paid', method = p_method, paid_at = now()
  where id = p_charge and status = 'pending';
  if not found then raise exception 'Pedido não encontrado ou já confirmado.'; end if;
end $$;
revoke execute on function confirm_order(uuid, text) from public, anon;
grant execute on function confirm_order(uuid, text) to authenticated;

-- Recusa o pedido: libera os horários criados nele, devolve o cupom e remove a cobrança.
create or replace function reject_order(p_charge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c charges%rowtype;
begin
  if not is_admin() then raise exception 'Apenas administradores.'; end if;
  select * into c from charges where id = p_charge and origin = 'teacher' and status = 'pending' for update;
  if not found then raise exception 'Pedido não encontrado ou já confirmado.'; end if;

  update slots set active = false, student_id = null, student = null
  where teacher_id = c.teacher_id and created_at = c.created_at and active;
  delete from coupon_uses where charge_id = c.id;
  delete from charges where id = c.id;
end $$;
revoke execute on function reject_order(uuid) from public, anon;
grant execute on function reject_order(uuid) to authenticated;

-- ---------- aviso para o professor ----------
-- Quantos pedidos dele ainda aguardam a confirmação do pagamento.
create or replace function my_pending_orders() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  return (select json_build_object('count', count(*), 'total_cents', coalesce(sum(amount_cents), 0))
          from charges where teacher_id = uid and origin = 'teacher' and status = 'pending');
end $$;
revoke execute on function my_pending_orders() from public, anon;
grant execute on function my_pending_orders() to authenticated;

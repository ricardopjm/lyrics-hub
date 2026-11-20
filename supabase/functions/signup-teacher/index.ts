// Edge Function PÚBLICA: o professor novo se cadastra e fecha o primeiro plano, sem ter login ainda.
// A conta nasce INATIVA e os horários ficam reservados até o administrador confirmar o pagamento.
// IMPORTANTE: ao publicar, desligue "Verify JWT" desta função (ela é pública de propósito).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'Método inválido.' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
  const picks = Array.isArray(body.picks) ? body.picks : [];
  const coupon = body.coupon ? String(body.coupon) : null;

  // Cotação com cupom (sem criar nada).
  if (body.action === 'quote') {
    const { data, error } = await admin.rpc('signup_quote', { p_count: picks.length, p_code: coupon });
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }
  if (body.action !== 'create') return json({ error: 'Ação inválida.' }, 400);

  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const phone = String(body.phone ?? '').trim();
  const password = String(body.password ?? '');
  if (name.length < 3 || name.length > 80) return json({ error: 'Informe o seu nome completo.' }, 400);
  if (!EMAIL.test(email)) return json({ error: 'E-mail inválido.' }, 400);
  if (password.length < 8) return json({ error: 'A senha precisa ter ao menos 8 caracteres.' }, 400);
  if (picks.length < 1 || picks.length > 20) return json({ error: 'Escolha de 1 a 20 horários.' }, 400);

  // E-mail que já existe?
  const { data: existing } = await admin
    .from('profiles').select('id, active, pending_signup, plan_until').eq('email', email).maybeSingle();

  let userId: string;
  let created = false;
  if (existing) {
    if (existing.pending_signup) {
      return json({ error: 'Já existe um pedido aguardando confirmação para este e-mail. Fale com a Lyrics.' }, 409);
    }
    const { count } = await admin.from('charges').select('id', { count: 'exact', head: true })
      .eq('teacher_id', existing.id).eq('status', 'paid');
    if (existing.active || (count ?? 0) > 0 || existing.plan_until) {
      return json({ error: 'Este e-mail já tem cadastro. Entre com a sua senha.' }, 409);
    }
    // Cadastro anterior que nunca foi pago (recusado ou expirado): reaproveita a conta.
    const { error: uErr } = await admin.auth.admin.updateUserById(existing.id, { password, user_metadata: { name } });
    if (uErr) return json({ error: uErr.message }, 400);
    await admin.from('profiles').update({ name, phone, pending_signup: true, active: false }).eq('id', existing.id);
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (error) {
      const m = error.message.toLowerCase();
      return json({ error: m.includes('registered') ? 'Este e-mail já tem cadastro.'
        : m.includes('password') ? 'Senha fraca. Use ao menos 8 caracteres.' : error.message }, 400);
    }
    userId = data.user.id;
    created = true;
    const { error: pErr } = await admin.from('profiles')
      .insert({ id: userId, role: 'teacher', name, email, phone, active: false, pending_signup: true });
    if (pErr) { await admin.auth.admin.deleteUser(userId); return json({ error: pErr.message }, 400); }
  }

  // Reserva os horários e cria o pedido. Se falhar (horário ocupado, cupom inválido), desfaz tudo.
  const { data: order, error: oErr } = await admin.rpc('signup_order', { p_user: userId, p_slots: picks, p_coupon: coupon });
  if (oErr) {
    if (created) await admin.auth.admin.deleteUser(userId);
    else await admin.from('profiles').update({ pending_signup: false }).eq('id', userId);
    return json({ error: oErr.message }, 400);
  }
  return json({ ok: true, ...order });
});

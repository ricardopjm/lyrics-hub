// Edge Function: cria um professor. SÓ administradores conseguem chamar.
// Deploy: supabase functions deploy invite-teacher
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1. Quem está chamando precisa ser admin ativo.
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Não autenticado.' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single();
  if (me?.role !== 'admin' || !me.active) return json({ error: 'Apenas administradores.' }, 403);

  // 2. Valida os dados.
  const { name, email, phone, password } = await req.json();
  if (!name || !email) return json({ error: 'Nome e e-mail são obrigatórios.' }, 400);
  if (!password || String(password).length < 8) return json({ error: 'A senha provisória precisa ter ao menos 8 caracteres.' }, 400);

  // 3. Cria o usuário já confirmado, com a senha provisória que o admin passou ao professor.
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (error) return json({ error: error.message }, 400);

  const { error: pErr } = await admin.from('profiles').insert({
    id: data.user.id, role: 'teacher', name, email, phone,
  });
  if (pErr) return json({ error: pErr.message }, 400);

  return json({ id: data.user.id });
});

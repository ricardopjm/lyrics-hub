import { endOf, pricePerSlot } from '../config';
import { DEMO, supabase } from './supabase';

export type Role = 'admin' | 'teacher';
export type User = { id: string; role: Role; name: string };
export type Slot = {
  id: string; roomId: string; room: string; teacherId: string; teacher: string;
  weekday: number; start: string; end: string; student: string | null;
};
export type Event = { id: string; kind: 'aula' | 'falta' | 'troca' | 'obs' | 'pagamento'; note: string; at: string };
export type Teacher = { id: string; name: string; email: string; phone: string };
export type Charge = {
  id: string; teacher: string; cents: number; due: string;
  status: 'pending' | 'paid' | 'overdue'; method: 'pix' | 'machine' | null; note?: string | null;
  origin?: 'teacher' | 'admin'; // 'teacher' pendente = pedido aguardando confirmação do pagamento
};

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------- modo demonstração ----------
const demo = {
  users: {
    admin: { id: 'a1', role: 'admin', name: 'Admin Lyrics' } as User,
    teacher: { id: 't1', role: 'teacher', name: 'Marina Costa' } as User,
  },
  teachers: [
    { id: 't1', name: 'Marina Costa', email: 'marina@exemplo.com', phone: '(00) 00000-0000' },
    { id: 't2', name: 'Paulo Ribeiro', email: 'paulo@exemplo.com', phone: '(00) 00000-0000' },
  ] as Teacher[],
  slots: [
    { id: 's1', roomId: 'Sala', room: 'Sala', teacherId: 't1', teacher: 'Marina Costa', weekday: 1, start: '14:00', end: '15:00', student: 'Aluno A' },
    { id: 's2', roomId: 'Sala', room: 'Sala', teacherId: 't2', teacher: 'Paulo Ribeiro', weekday: 1, start: '15:00', end: '16:00', student: 'Aluno B' },
    { id: 's3', roomId: 'Sala', room: 'Sala', teacherId: 't1', teacher: 'Marina Costa', weekday: 3, start: '10:00', end: '11:00', student: 'Aluno C' },
  ] as Slot[],
  events: {
    s1: [
      { id: 'e1', kind: 'aula', note: 'Aula realizada.', at: '2026-11-16T14:00:00' },
      { id: 'e2', kind: 'falta', note: 'Aluno avisou que faltaria.', at: '2026-11-09T14:00:00' },
    ],
  } as Record<string, Event[]>,
  charges: [
    { id: 'c1', teacher: 'Marina Costa', cents: 30000, due: '2026-12-05', status: 'pending', method: null },
    { id: 'c2', teacher: 'Paulo Ribeiro', cents: 15000, due: '2026-11-05', status: 'paid', method: 'pix' },
  ] as Charge[],
};

export const demoUser = (r: Role) => demo.users[r];

// ---------- API ----------
export async function loadProfile(id: string): Promise<User> {
  const { data, error } = await supabase.from('profiles').select('id, role, name, active, pending_signup').eq('id', id).single();
  if (error) throw error;
  // Cadastro novo aguardando o pagamento, ou professor desligado: não entra no sistema.
  if (!data.active) throw new Error(data.pending_signup ? 'pending' : 'inactive');
  return { id: data.id, role: data.role, name: data.name } as User;
}

export async function listSlots(user: User): Promise<Slot[]> {
  if (DEMO) return demo.slots.filter((s) => user.role === 'admin' || s.teacherId === user.id);
  const { data, error } = await supabase
    .from('slots')
    .select('id, room_id, weekday, start_time, end_time, student, teacher_id, rooms(name), profiles(name)')
    .eq('active', true)
    .order('weekday').order('start_time');
  if (error) throw error;
  return (data as any[]).map((s) => ({
    id: s.id, roomId: s.room_id, room: s.rooms?.name ?? '', teacherId: s.teacher_id, teacher: s.profiles?.name ?? '',
    weekday: s.weekday, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), student: s.student,
  }));
}

export async function getSlot(id: string, user: User) {
  return (await listSlots(user)).find((s) => s.id === id) ?? null;
}

export async function listEvents(slotId: string): Promise<Event[]> {
  if (DEMO) return demo.events[slotId] ?? [];
  const { data, error } = await supabase
    .from('slot_events').select('id, kind, note, created_at').eq('slot_id', slotId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as any[]).map((e) => ({ id: e.id, kind: e.kind, note: e.note ?? '', at: e.created_at }));
}

// lessonDate: dia da aula (AAAA-MM-DD). Vazio = hoje.
export async function addEvent(slotId: string, kind: Event['kind'], note: string, user: User, lessonDate?: string) {
  if (DEMO) {
    (demo.events[slotId] ??= []).unshift({ id: String(Date.now()), kind, note, at: new Date().toISOString() });
    return;
  }
  const { error } = await supabase.from('slot_events').insert({
    slot_id: slotId, kind, note, created_by: user.id, ...(lessonDate ? { lesson_date: lessonDate } : {}),
  });
  if (error) throw error;
}

export async function listTeachers(): Promise<Teacher[]> {
  if (DEMO) return [...demo.teachers];
  const { data, error } = await supabase
    .from('profiles').select('id, name, email, phone').eq('role', 'teacher').eq('active', true).order('name');
  if (error) throw error;
  return data as Teacher[];
}

// Só admins conseguem: a Edge Function e as regras do banco recusam qualquer outro.
export async function createTeacher(t: { name: string; email: string; phone: string; password: string }) {
  if (DEMO) {
    demo.teachers.push({ id: 't' + Date.now(), name: t.name, email: t.email, phone: t.phone });
    return;
  }
  const { data, error } = await supabase.functions.invoke('invite-teacher', { body: t });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

export async function listCharges(): Promise<Charge[]> {
  if (DEMO) return demo.charges.map((c) => ({ ...c }));
  const { data, error } = await supabase
    .from('charges').select('id, amount_cents, due_date, status, method, note, origin, profiles(name)').order('due_date');
  if (error) throw error;
  return (data as any[]).map((c) => ({
    id: c.id, teacher: c.profiles?.name ?? '', cents: c.amount_cents, due: c.due_date,
    status: c.status, method: c.method, note: c.note, origin: c.origin,
  }));
}

export async function markPaid(id: string, method: 'pix' | 'machine') {
  if (DEMO) {
    const c = demo.charges.find((x) => x.id === id);
    if (c) { c.status = 'paid'; c.method = method; }
    return;
  }
  const { error } = await supabase
    .from('charges').update({ status: 'paid', method, paid_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}


// ---------- disponibilidade pública e reserva ----------
export type Room = { id: string; name: string };
export type Availability = { rooms: Room[]; taken: { room_id: string; weekday: number; start: string }[] };
export type Pick = { room_id: string; weekday: number; start: string };
export type BookResult = {
  count: number; per_slot_cents: number; total_cents: number; charged_cents: number; internal?: boolean;
  discount_cents?: number; coupon_code?: string | null;
};

// Funciona SEM login: só diz o que está ocupado, sem nomes.
export async function getAvailability(): Promise<Availability> {
  if (DEMO) {
    return {
      rooms: [{ id: 'Sala', name: 'Sala' }],
      taken: demo.slots.map((s) => ({ room_id: s.roomId, weekday: s.weekday, start: s.start })),
    };
  }
  const { data, error } = await supabase.rpc('availability');
  if (error) throw error;
  return data as Availability;
}

// Preço calculado no servidor. No modo demonstração, repete a mesma regra.
export type BookOptions = {
  teacher?: { id: string; name: string }; // admin reservando para um professor
  internal?: boolean;                     // admin reservando para si mesmo (sem custo, salvo valor manual)
  amountCents?: number | null;            // valor manual (admin). Vazio = automático (professor) ou sem custo (si mesmo)
  note?: string;                          // descrição da cobrança, ex.: "Evento"
  coupon?: string;                        // cupom de desconto (só o professor, nos próprios horários)
};

export async function bookSlots(user: User, picks: Pick[], opts: BookOptions = {}): Promise<BookResult> {
  const internal = !!opts.internal;
  const who = opts.teacher ?? { id: user.id, name: user.name };
  if (!DEMO) {
    const { data, error } = await supabase.rpc('book_slots', {
      p: picks,
      p_teacher: internal ? user.id : opts.teacher?.id ?? null,
      p_amount_cents: opts.amountCents ?? null,
      p_note: opts.note?.trim() || null,
      p_coupon: opts.coupon?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return data as BookResult;
  }
  for (const p of picks) {
    if (demo.slots.some((s) => s.roomId === p.room_id && s.weekday === p.weekday && s.start === p.start))
      throw new Error('Um dos horários acabou de ser ocupado. Atualize e escolha outro.');
  }
  for (const p of picks) {
    demo.slots.push({
      id: 's' + Math.random().toString(36).slice(2), roomId: p.room_id, room: p.room_id,
      teacherId: who.id, teacher: who.name, weekday: p.weekday, start: p.start,
      end: endOf(p.start), student: null,
    });
  }
  const total = demo.slots.filter((s) => s.teacherId === who.id).length;
  if (internal) {
    const own = opts.amountCents ?? 0;
    if (own > 0) {
      demo.charges.push({
        id: 'c' + Date.now(), teacher: who.name, cents: own, status: 'pending', method: null, note: opts.note?.trim() || null,
        due: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
      });
    }
    return { count: total, per_slot_cents: 0, total_cents: 0, charged_cents: own, internal: true };
  }
  const per = pricePerSlot(total);
  const due = total * per;
  const already = demo.charges.filter((c) => c.teacher === who.name).reduce((a, c) => a + c.cents, 0);
  const gross = opts.amountCents != null ? opts.amountCents : Math.max(due - already, 0);
  let discount = 0, usedCode: string | null = null;
  if (opts.coupon?.trim()) {
    const cp = demoCoupons.find((x) => x.code === opts.coupon!.trim().toUpperCase() && x.active);
    if (!cp) throw new Error('Cupom inválido.');
    if (gross <= 0) throw new Error('Não há valor a cobrar para aplicar o cupom.');
    discount = cp.kind === 'percent' ? Math.floor((gross * cp.value) / 100) : Math.min(cp.value, gross);
    usedCode = cp.code;
  }
  const diff = gross - discount;
  if (gross > 0) {
    demo.charges.push({
      id: 'c' + Date.now(), teacher: who.name, cents: diff, status: diff === 0 ? 'paid' : 'pending', method: null, note: opts.note?.trim() || null,
      due: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
    });
  }
  return { count: total, per_slot_cents: per, total_cents: due, charged_cents: diff, discount_cents: discount, coupon_code: usedCode };
}

// Desliga o professor: libera os horários dele e tira o acesso ao app.
// O histórico e as cobranças já geradas continuam guardados no financeiro.
export async function deleteTeacher(id: string) {
  if (DEMO) {
    demo.teachers = demo.teachers.filter((t) => t.id !== id);
    demo.slots = demo.slots.filter((s) => s.teacherId !== id);
    return;
  }
  const a = await supabase.from('slots').update({ active: false }).eq('teacher_id', id);
  if (a.error) throw a.error;
  const b = await supabase.from('profiles').update({ active: false }).eq('id', id).eq('role', 'teacher');
  if (b.error) throw b.error;
}


// ---------- painel inicial ----------
export type TeacherDash = {
  role: 'teacher'; month: string; planned: number; done: number; missed: number; students: number;
  slots: { id: string; weekday: number; start: string; student: string | null }[];
  renewed: boolean; next_cycle: string; next_cents: number;
};
export type AdminDash = {
  role: 'admin'; capacity: number; occupied: number; teachers: number; students: number;
  received_cents: number; pending_cents: number; done_month: number; by_weekday: number[];
  today: { start: string; teacher: string; student: string | null }[];
};
export type Dash = TeacherDash | AdminDash;

export async function getDashboard(user: User): Promise<Dash> {
  if (DEMO) {
    if (user.role === 'admin') {
      return {
        role: 'admin', capacity: 74, occupied: demo.slots.length, teachers: demo.teachers.length,
        students: new Set(demo.slots.map((s) => s.student).filter(Boolean)).size,
        received_cents: demo.charges.filter((c) => c.status === 'paid').reduce((a, c) => a + c.cents, 0),
        pending_cents: demo.charges.filter((c) => c.status !== 'paid').reduce((a, c) => a + c.cents, 0),
        done_month: 5, by_weekday: [0, 1, 2, 3, 4, 5, 6].map((d) => demo.slots.filter((s) => s.weekday === d).length),
        today: demo.slots.filter((s) => s.weekday === new Date().getDay())
          .map((s) => ({ start: s.start, teacher: s.teacher, student: s.student })),
      };
    }
    const mine = demo.slots.filter((s) => s.teacherId === user.id);
    return {
      role: 'teacher', month: new Date().toISOString().slice(0, 7), planned: 4, done: 3, missed: 0,
      students: new Set(mine.map((s) => s.student).filter(Boolean)).size,
      slots: mine.map((s) => ({ id: s.id, weekday: s.weekday, start: s.start, student: s.student })),
      renewed: false, next_cycle: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 7),
      next_cents: mine.length * pricePerSlot(mine.length),
    };
  }
  const { data, error } = await supabase.rpc(user.role === 'admin' ? 'admin_dashboard' : 'my_dashboard');
  if (error) throw new Error(error.message);
  return { ...(data as object), role: user.role } as Dash;
}

// ---------- renovação com cupom ----------
export type Quote = {
  count: number; per_slot_cents: number; subtotal_cents: number; discount_cents: number;
  total_cents: number; cycle: string; coupon_code: string | null;
};
export type Coupon = {
  id: string; code: string; kind: 'percent' | 'fixed'; value: number;
  expires_at: string | null; max_uses: number | null; active: boolean; uses: number;
};

// Demonstração: um cupom de exemplo.
const demoCoupons: Coupon[] = [
  { id: 'k1', code: 'PROMO10', kind: 'percent', value: 10, expires_at: null, max_uses: null, active: true, uses: 0 },
];

// Resumo do que o professor está comprando, com ou sem cupom. O servidor calcula o desconto.
export async function getRenewalQuote(user: User, code?: string): Promise<Quote> {
  if (!DEMO) {
    const { data, error } = await supabase.rpc('renewal_quote_me', { p_code: code?.trim() || null });
    if (error) throw new Error(error.message);
    return data as Quote;
  }
  const n = demo.slots.filter((s) => s.teacherId === user.id).length;
  if (n === 0) throw new Error('Você ainda não tem horários para renovar.');
  const per = pricePerSlot(n), sub = n * per;
  let disc = 0, used: string | null = null;
  if (code?.trim()) {
    const cp = demoCoupons.find((x) => x.code === code.trim().toUpperCase() && x.active);
    if (!cp) throw new Error('Cupom inválido.');
    disc = cp.kind === 'percent' ? Math.floor((sub * cp.value) / 100) : Math.min(cp.value, sub);
    used = cp.code;
  }
  return {
    count: n, per_slot_cents: per, subtotal_cents: sub, discount_cents: disc, total_cents: sub - disc,
    cycle: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 7), coupon_code: used,
  };
}

// Gera a cobrança do próximo mês com os horários atuais (professor), com cupom opcional.
export async function renewPlan(user: User, code?: string) {
  if (DEMO) {
    const q = await getRenewalQuote(user, code);
    demo.charges.push({
      id: 'c' + Date.now(), teacher: user.name, cents: q.total_cents, status: q.total_cents === 0 ? 'paid' : 'pending',
      method: null, note: 'Renovação do plano' + (q.coupon_code ? ` · cupom ${q.coupon_code}` : ''),
      due: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
    });
    return;
  }
  const { error } = await supabase.rpc('renew_plan', { p_code: code?.trim() || null });
  if (error) throw new Error(error.message);
}

// ---------- cupons (administradores) ----------
export async function listCoupons(): Promise<Coupon[]> {
  if (DEMO) return demoCoupons.map((c) => ({ ...c }));
  const { data, error } = await supabase
    .from('coupons').select('id, code, kind, value, expires_at, max_uses, active, coupon_uses(count)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as any[]).map((c) => ({ ...c, uses: c.coupon_uses?.[0]?.count ?? 0 }));
}

export async function createCoupon(c: { code: string; kind: 'percent' | 'fixed'; value: number; expires_at: string | null; max_uses: number | null }) {
  const row = { ...c, code: c.code.trim().toUpperCase().replace(/\s+/g, '') };
  if (DEMO) { demoCoupons.unshift({ id: 'k' + Date.now(), active: true, uses: 0, ...row }); return; }
  const { error } = await supabase.from('coupons').insert(row);
  if (error) throw new Error(error.code === '23505' ? 'Já existe um cupom com esse código.' : error.message);
}

export async function setCouponActive(id: string, active: boolean) {
  if (DEMO) { const c = demoCoupons.find((x) => x.id === id); if (c) c.active = active; return; }
  const { error } = await supabase.from('coupons').update({ active }).eq('id', id);
  if (error) throw error;
}

// Cotação do fechamento de horários com cupom (professor). O servidor calcula tudo.
export type BookingQuote = {
  count: number; per_slot_cents: number; monthly_cents: number; gross_cents: number;
  discount_cents: number; pay_cents: number; coupon_code: string | null;
};
export async function getBookingQuote(user: User, newCount: number, code: string): Promise<BookingQuote> {
  if (!DEMO) {
    const { data, error } = await supabase.rpc('booking_quote_me', { p_new: newCount, p_code: code.trim() || null });
    if (error) throw new Error(error.message);
    return data as BookingQuote;
  }
  const total = demo.slots.filter((s) => s.teacherId === user.id).length + newCount;
  const per = pricePerSlot(total), due = total * per;
  const already = demo.charges.filter((c) => c.teacher === user.name).reduce((a, c) => a + c.cents, 0);
  const gross = Math.max(due - already, 0);
  let disc = 0, used: string | null = null;
  if (code.trim()) {
    const cp = demoCoupons.find((x) => x.code === code.trim().toUpperCase() && x.active);
    if (!cp) throw new Error('Cupom inválido.');
    if (gross <= 0) throw new Error('Não há valor a cobrar para aplicar o cupom.');
    disc = cp.kind === 'percent' ? Math.floor((gross * cp.value) / 100) : Math.min(cp.value, gross);
    used = cp.code;
  }
  return { count: total, per_slot_cents: per, monthly_cents: due, gross_cents: gross, discount_cents: disc, pay_cents: gross - disc, coupon_code: used };
}

// ---------- alunos ----------
export type Student = {
  id: string; name: string; phone: string | null; note: string | null;
  slots: number; done: number; missed: number;
};
export type HistoryItem = { id: string; kind: 'aula' | 'falta' | 'nota'; date: string; note: string };
export type ReportRow = {
  lesson_date: string; weekday: number; start: string; slot_id: string;
  student: string | null; student_id: string | null; status: 'aula' | 'falta' | null; note: string | null;
};

const demoStudents: { id: string; owner: string; name: string; phone: string | null; note: string | null }[] = [
  { id: 'a1', owner: 't1', name: 'Ana Souza', phone: null, note: 'Violão, nível iniciante.' },
  { id: 'a2', owner: 't1', name: 'Bruno Lima', phone: null, note: null },
];
const demoNotes: { id: string; studentId: string; note: string; at: string }[] = [
  { id: 'n1', studentId: 'a1', note: 'Aprendeu os primeiros acordes.', at: '2026-11-16T15:00:00' },
];

// Alunos de uma pessoa, com quantos horários, aulas dadas e faltas cada um tem.
export async function listStudents(ownerId: string): Promise<Student[]> {
  if (DEMO) {
    return demoStudents.filter((s) => s.owner === ownerId).map((s) => ({
      id: s.id, name: s.name, phone: s.phone, note: s.note,
      slots: demo.slots.filter((x) => x.student === s.name).length,
      done: (demo.events['s1'] ?? []).filter((e) => e.kind === 'aula').length && s.name === 'Ana Souza' ? 1 : 0, missed: 0,
    }));
  }
  const { data, error } = await supabase
    .from('students').select('id, name, phone, note').eq('owner_id', ownerId).eq('active', true).order('name');
  if (error) throw error;
  const ids = (data as any[]).map((s) => s.id);
  if (ids.length === 0) return [];
  const [sl, ev] = await Promise.all([
    supabase.from('slots').select('student_id').eq('teacher_id', ownerId).eq('active', true).in('student_id', ids),
    supabase.from('slot_events').select('student_id, kind').in('student_id', ids).in('kind', ['aula', 'falta']),
  ]);
  const count = (rows: any[] | null, id: string, kind?: string) =>
    (rows ?? []).filter((r) => r.student_id === id && (!kind || r.kind === kind)).length;
  return (data as any[]).map((s) => ({
    ...s, slots: count(sl.data, s.id), done: count(ev.data, s.id, 'aula'), missed: count(ev.data, s.id, 'falta'),
  }));
}

export async function getStudent(id: string): Promise<Student | null> {
  if (DEMO) {
    const s = demoStudents.find((x) => x.id === id);
    return s ? { id: s.id, name: s.name, phone: s.phone, note: s.note, slots: 0, done: 0, missed: 0 } : null;
  }
  const { data, error } = await supabase.from('students').select('id, name, phone, note, owner_id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [sl, ev] = await Promise.all([
    supabase.from('slots').select('student_id').eq('student_id', id).eq('active', true),
    supabase.from('slot_events').select('kind').eq('student_id', id).in('kind', ['aula', 'falta']),
  ]);
  const evs = (ev.data ?? []) as any[];
  return { id: data.id, name: data.name, phone: data.phone, note: data.note, slots: (sl.data ?? []).length,
    done: evs.filter((e) => e.kind === 'aula').length, missed: evs.filter((e) => e.kind === 'falta').length };
}

export async function createStudent(user: User, s: { name: string; phone: string; note: string }) {
  const row = { name: s.name.trim(), phone: s.phone.trim() || null, note: s.note.trim() || null };
  if (DEMO) { demoStudents.push({ id: 'a' + Date.now(), owner: user.id, ...row }); return; }
  const { error } = await supabase.from('students').insert(row);
  if (error) throw new Error(error.message);
}

export async function updateStudent(id: string, s: { name: string; phone: string; note: string }) {
  const row = { name: s.name.trim(), phone: s.phone.trim() || null, note: s.note.trim() || null };
  if (DEMO) { const d = demoStudents.find((x) => x.id === id); if (d) Object.assign(d, row); return; }
  const { error } = await supabase.from('students').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

// Arquiva o aluno: some da lista e dos horários; o histórico fica guardado.
export async function archiveStudent(id: string) {
  if (DEMO) { const i = demoStudents.findIndex((x) => x.id === id); if (i >= 0) demoStudents.splice(i, 1); return; }
  const { error } = await supabase.rpc('archive_student', { p_student: id });
  if (error) throw new Error(error.message);
}

// Aulas, faltas e anotações do aluno, da mais recente para a mais antiga.
export async function getStudentHistory(id: string): Promise<HistoryItem[]> {
  if (DEMO) {
    return demoNotes.filter((n) => n.studentId === id)
      .map((n) => ({ id: n.id, kind: 'nota' as const, date: n.at.slice(0, 10), note: n.note }));
  }
  const [ev, nt] = await Promise.all([
    supabase.from('slot_events').select('id, kind, note, lesson_date, created_at').eq('student_id', id)
      .in('kind', ['aula', 'falta']),
    supabase.from('student_notes').select('id, note, created_at').eq('student_id', id),
  ]);
  if (ev.error) throw ev.error;
  if (nt.error) throw nt.error;
  const items: (HistoryItem & { at: string })[] = [
    ...((ev.data ?? []) as any[]).map((e) => ({ id: e.id, kind: e.kind, date: e.lesson_date, note: e.note ?? '', at: e.created_at })),
    ...((nt.data ?? []) as any[]).map((n) => ({ id: n.id, kind: 'nota' as const, date: n.created_at.slice(0, 10), note: n.note, at: n.created_at })),
  ];
  return items.sort((a, b) => (a.date === b.date ? b.at.localeCompare(a.at) : b.date.localeCompare(a.date)));
}

export async function addStudentNote(studentId: string, note: string) {
  if (DEMO) { demoNotes.unshift({ id: 'n' + Date.now(), studentId, note: note.trim(), at: new Date().toISOString() }); return; }
  const { error } = await supabase.from('student_notes').insert({ student_id: studentId, note: note.trim() });
  if (error) throw new Error(error.message);
}

// Relatório da semana (segunda a domingo) que contém a data. Datas em AAAA-MM-DD.
export async function getWeeklyReport(weekStart: string): Promise<ReportRow[]> {
  if (DEMO) {
    return demo.slots.filter((s) => s.teacherId === 't1' || s.teacherId === 'a1').map((s) => {
      const d = new Date(weekStart + 'T12:00:00');
      d.setDate(d.getDate() + ((s.weekday + 6) % 7));
      return { lesson_date: d.toISOString().slice(0, 10), weekday: s.weekday, start: s.start, slot_id: s.id,
        student: s.student, student_id: null, status: null, note: null };
    });
  }
  const { data, error } = await supabase.rpc('weekly_report', { p_week_start: weekStart });
  if (error) throw new Error(error.message);
  return data as ReportRow[];
}

// Escolhe (ou tira, com null) o aluno de um horário.
export async function setSlotStudent(slotId: string, studentId: string | null) {
  if (DEMO) {
    const s = demo.slots.find((x) => x.id === slotId);
    if (s) s.student = studentId ? demoStudents.find((x) => x.id === studentId)?.name ?? null : null;
    return;
  }
  const { error } = await supabase.rpc('set_slot_student', { p_slot: slotId, p_student: studentId });
  if (error) throw new Error(error.message);
}

// ---------- pedidos aguardando confirmação do pagamento ----------
export type Order = {
  id: string; teacher: string; email: string | null; phone: string | null; signup: boolean;
  amount_cents: number; discount_cents: number; coupon_code: string | null;
  note: string | null; created_at: string; cycle: string; kind: 'renovacao' | 'novo';
  slots: { weekday: number; start: string }[];
};

// Fila do administrador: pedidos de professores com pagamento ainda não conferido.
export async function listOrders(): Promise<Order[]> {
  if (DEMO) return [];
  const { data, error } = await supabase.rpc('pending_orders');
  if (error) throw new Error(error.message);
  return data as Order[];
}

// O administrador conferiu que o pagamento caiu: vira "Recebido" e entra no Financeiro.
export async function confirmOrder(id: string) {
  if (DEMO) return;
  const { error } = await supabase.rpc('confirm_order', { p_charge: id, p_method: 'pix' });
  if (error) throw new Error(error.message);
}

// Recusa: os horários do pedido voltam a ficar livres e o cupom é devolvido.
export async function rejectOrder(id: string) {
  if (DEMO) return;
  const { error } = await supabase.rpc('reject_order', { p_charge: id });
  if (error) throw new Error(error.message);
}

// Quantos pedidos do professor ainda aguardam a confirmação.
export async function getMyPendingOrders(): Promise<{ count: number; total_cents: number }> {
  if (DEMO) return { count: 0, total_cents: 0 };
  const { data, error } = await supabase.rpc('my_pending_orders');
  if (error) throw new Error(error.message);
  return data as { count: number; total_cents: number };
}

// ---------- cadastro público do professor novo ----------
export type Pick2 = { room_id: string; weekday: number; start: string };
export type SignupQuote = {
  count: number; per_slot_cents: number; gross_cents: number; discount_cents: number; pay_cents: number; coupon_code: string | null;
};
export type SignupResult = {
  count: number; per_slot_cents: number; total_cents: number; charged_cents: number; discount_cents: number; coupon_code: string | null;
};

async function callSignup(body: object): Promise<any> {
  if (DEMO) throw new Error('O cadastro só funciona com o servidor ligado.');
  const { data, error } = await supabase.functions.invoke('signup-teacher', { body });
  // Erros da função vêm no corpo da resposta (status 4xx).
  if (error) {
    try { const j = await (error as any).context?.json?.(); if (j?.error) throw new Error(j.error); } catch (e: any) { if (e?.message) throw e; }
    throw new Error('Não foi possível concluir o cadastro. Tente novamente.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Preço com cupom para quem ainda não tem conta (sem criar nada).
export const signupQuote = (picks: Pick2[], coupon: string): Promise<SignupQuote> =>
  callSignup({ action: 'quote', picks, coupon: coupon.trim() || null });

// Cria a conta INATIVA, reserva os horários e gera o pedido para o administrador conferir.
export const signupTeacher = (f: { name: string; email: string; phone: string; password: string; picks: Pick2[]; coupon: string }): Promise<SignupResult> =>
  callSignup({ action: 'create', ...f, coupon: f.coupon.trim() || null });

// Situação do plano do professor logado (vencido => botão "Contratar novo plano").
export async function getMyPlan(): Promise<{ plan_until: string | null; expired: boolean; has_slots: boolean }> {
  if (DEMO) return { plan_until: null, expired: false, has_slots: true };
  const { data, error } = await supabase.rpc('my_plan');
  if (error) throw new Error(error.message);
  return data as { plan_until: string | null; expired: boolean; has_slots: boolean };
}

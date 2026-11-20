import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { OPEN_WEEKDAYS, TIERS, hoursFor, pricePerSlot } from './config';
import { useAuth } from './lib/auth';
import { Availability, BookResult, BookingQuote, Teacher, WEEKDAYS, bookSlots, brl, getAvailability, getBookingQuote, listSlots, listTeachers } from './lib/data';
import { notify } from './notify';
import { c, f, label } from './theme';
import { buildOrderMessage, openWhatsApp } from './whatsapp';
import { Button, Field, Header, s } from './ui';

const key = (room: string, weekday: number, start: string) => `${room}|${weekday}|${start}`;

export default function Horarios() {
  const { user } = useAuth();
  const router = useRouter();
  const [av, setAv] = useState<Availability | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [day, setDay] = useState(OPEN_WEEKDAYS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<BookResult | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // Para quem o administrador reserva: 'admin' = administração (sem custo) ou o id de um professor.
  const [target, setTarget] = useState<string | null>(null);
  const [manual, setManual] = useState(''); // valor manual (R$), opcional
  const [note, setNote] = useState('');       // descrição da cobrança, opcional
  // Cupom de desconto (opcional, só professor): código digitado, cotação aplicada e erro do cupom.
  const [couponInput, setCouponInput] = useState('');
  const [couponQuote, setCouponQuote] = useState<BookingQuote | null>(null);
  const [couponError, setCouponError] = useState('');
  const [orderText, setOrderText] = useState(''); // pedido enviado pelo WhatsApp (professor)
  const isAdmin = user?.role === 'admin';
  const internal = isAdmin && target === 'admin';
  const teacher = isAdmin && !internal ? teachers.find((t) => t.id === target) : undefined;
  const ownerId = internal ? user?.id : teacher?.id; // de quem são os horários mostrados como "seus"

  const load = useCallback(async () => {
    try {
      setAv(await getAvailability());
      if (user?.role === 'admin') setTeachers(await listTeachers());
      if (user) {
        // Professor vê os próprios horários; admin vê os do professor escolhido.
        const m = (await listSlots(user)).filter((x) => user.role === 'teacher' || x.teacherId === ownerId);
        setMine(new Set(m.map((x) => key(x.roomId, x.weekday, x.start))));
      }
    } catch (e: any) { setError(e.message ?? 'Não foi possível carregar os horários.'); }
  }, [user, ownerId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const taken = useMemo(
    () => new Set((av?.taken ?? []).map((t) => key(t.room_id, t.weekday, t.start))), [av]);

  const canBook = true; // visitante simula; professor e administrador reservam
  const total = mine.size + picked.size; // quantidade de horários semanais dele
  const per = pricePerSlot(total);

  const toggle = (k: string) => {
    if (isAdmin && !target) { setError('Escolha para quem é a reserva antes de selecionar os horários.'); return; }
    setDone(null); setOrderText(''); setError('');
    setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const isTeacher = user?.role === 'teacher';

  const applyCoupon = async (code = couponInput) => {
    if (!user || !code.trim()) return;
    try {
      setCouponQuote(await getBookingQuote(user, picked.size, code)); setCouponError('');
    } catch (e: any) { setCouponQuote(null); setCouponError(e.message); }
  };
  const removeCoupon = () => { setCouponQuote(null); setCouponInput(''); setCouponError(''); };

  // Mudou a seleção com um cupom aplicado: recalcula o desconto; sem horários, limpa.
  useEffect(() => {
    if (!couponQuote) return;
    if (picked.size === 0) { removeCoupon(); return; }
    applyCoupon(couponQuote.coupon_code ?? couponInput);
  }, [picked.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    if (!user) {
      // Visitante: cria a conta (inativa até o pagamento) e fecha o primeiro plano.
      const chosen = [...picked].map((k) => {
        const [room_id, weekday, start] = k.split('|');
        return { room_id, weekday: Number(weekday), start };
      });
      router.push({ pathname: '/cadastro', params: { picks: JSON.stringify(chosen) } });
      return;
    }
    setBusy(true); setError('');
    try {
      const picks = [...picked].map((k) => {
        const [room_id, weekday, start] = k.split('|');
        return { room_id, weekday: Number(weekday), start };
      });
      const amountCents = manual.trim() === '' ? null : Math.round(parseFloat(manual.replace(',', '.')) * 100);
      if (amountCents !== null && (!Number.isFinite(amountCents) || amountCents < 0)) {
        setError('Valor manual inválido. Use, por exemplo, 150 ou 150,50.'); setBusy(false); return;
      }
      const res = await bookSlots(user, picks, isAdmin ? { internal, teacher, amountCents, note } : { coupon: couponQuote?.coupon_code ?? undefined });
      setDone(res);
      setManual(''); setNote(''); removeCoupon();
      // Professor: monta o pedido e abre o WhatsApp da Lyrics. O Pix é combinado por lá.
      if (!isAdmin) {
        const text = buildOrderMessage({
          name: user.name, kind: 'novo',
          slots: picks.map((p) => `${WEEKDAYS[p.weekday]} ${p.start}`), count: res.count,
          perSlotCents: res.per_slot_cents, subtotalCents: res.charged_cents + (res.discount_cents ?? 0),
          discountCents: res.discount_cents ?? 0, couponCode: res.coupon_code, totalCents: res.charged_cents,
        });
        setOrderText(text);
        try { await openWhatsApp(text); } catch (e: any) { notify('WhatsApp', e.message); }
      }
      setPicked(new Set());
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Não foi possível fechar os horários.');
      await load();
      setPicked(new Set());
    }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}>
        <Header eyebrow="Coworking mensal" title="Horários" em="disponíveis." />

        {/* tabela de preços */}
        <View style={{ marginHorizontal: 24, marginBottom: 20, backgroundColor: c.lavender, borderRadius: 14, padding: 16 }}>
          <Text style={[label, { marginBottom: 8 }]}>Valor mensal por horário semanal</Text>
          {TIERS.map((t) => (
            <View key={t.text} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={s.body}>{t.text}</Text>
              <Text style={[s.body, { color: c.violet }]}>{brl(t.cents)}</Text>
            </View>
          ))}
        </View>

        {/* administrador: para quem é a reserva */}
        {isAdmin ? (
          <View style={{ marginBottom: 16 }}>
            <Text style={[label, { paddingHorizontal: 24, marginBottom: 8 }]}>Reservar para</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
              {[{ id: 'admin', name: 'Eu (administração)' }, ...teachers].map((t) => (
                <Pressable key={t.id}
                  onPress={() => { setTarget(t.id); setPicked(new Set()); setDone(null); setError(''); setManual(''); setNote(''); }}
                  style={[chip.base, target === t.id && { backgroundColor: c.violet, borderColor: c.violet }]}>
                  <Text style={[chip.text, target === t.id && { color: c.white }]}>{t.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[s.muted, { paddingHorizontal: 24, marginTop: 8, fontSize: 13 }]}>
              Seus horários não geram cobrança, a menos que você preencha um valor.
            </Text>
          </View>
        ) : null}

        {/* dias */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, gap: 8, marginBottom: 16 }}>
          {OPEN_WEEKDAYS.map((d) => (
            <Pressable key={d} onPress={() => setDay(d)}
              style={[chip.base, day === d && { backgroundColor: c.violet, borderColor: c.violet }]}>
              <Text style={[chip.text, day === d && { color: c.white }]}>{WEEKDAYS[d].slice(0, 3)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {!av && !error ? <Text style={[s.muted, { paddingHorizontal: 24 }]}>Carregando horários…</Text> : null}

        {/* salas e horas */}
        {(av?.rooms ?? []).map((r) => (
          <View key={r.id} style={{ marginBottom: 16 }}>
            {(av?.rooms.length ?? 0) > 1 ? <Text style={[label, { paddingHorizontal: 24, marginBottom: 8 }]}>{r.name}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24 }}>
              {hoursFor(day).map((h) => {
                const k = key(r.id, day, h);
                const isMine = mine.has(k);
                const isTaken = taken.has(k) && !isMine;
                const isPicked = picked.has(k);
                return (
                  <Pressable key={h} disabled={isTaken || isMine || !canBook} onPress={() => toggle(k)}
                    style={[slot.base,
                      isTaken && slot.taken, isMine && slot.mine, isPicked && slot.picked]}>
                    <Text style={[slot.text, isTaken && { color: c.line }, isMine && { color: c.violet }, isPicked && { color: c.white }]}>
                      {h}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 24, marginTop: 4 }}>
          <Legend color={c.white} border={c.lilac} text="Livre" />
          <Legend color={c.violet} border={c.violet} text="Selecionado" />
          <Legend color={c.lavender} border={c.violet} text={isAdmin ? (internal ? 'Da administração' : 'Do professor') : 'Seu'} />
          <Legend color={c.sand} border={c.line} text="Ocupado" />
        </View>
      </ScrollView>

      {/* resumo e cobrança */}
      <View style={{ borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.white, paddingTop: 12, paddingBottom: 12 }}>
        {done ? (
          <Text style={[s.body, { paddingHorizontal: 24, marginBottom: 4, color: c.ok }]}>
            {done.internal
              ? (done.charged_cents > 0 ? `Horários reservados para você. Cobrança registrada: ${brl(done.charged_cents)}.` : 'Horários reservados para você, sem cobrança.')
              : `Horários fechados${teacher ? ` para ${teacher.name}` : ''}. ${isAdmin ? 'Total' : 'Agora você tem'} ${done.count} por semana: ${brl(done.per_slot_cents)} cada, ${brl(done.total_cents)} por mês.${done.charged_cents > 0 ? ` Cobrança gerada: ${brl(done.charged_cents)}${done.coupon_code ? ` (cupom ${done.coupon_code}, − ${brl(done.discount_cents ?? 0)})` : ''}.` : ' Nenhuma cobrança gerada.'}`}
          </Text>
        ) : null}
        {done && orderText ? (
          <Button text="Enviar pedido pelo WhatsApp" kind="line"
            onPress={() => openWhatsApp(orderText).catch((e) => notify('WhatsApp', e.message))} />
        ) : null}
        {error ? <Text style={[s.body, { paddingHorizontal: 24, color: c.bad }]}>{error}</Text> : null}
        {isAdmin && !target ? (
          <Text style={[s.muted, { paddingHorizontal: 24 }]}>Escolha para quem é a reserva.</Text>
        ) : internal ? (
          <Text style={[s.body, { paddingHorizontal: 24, marginBottom: 4 }]}>
            {picked.size > 0 ? `${picked.size} ${picked.size === 1 ? 'horário' : 'horários'} seus · sem custo, salvo valor preenchido` : 'Toque nos horários livres para reservar.'}
          </Text>
        ) : total > 0 ? (
          <View style={{ paddingHorizontal: 24, marginBottom: 4 }}>
            <Text style={s.body}>
              {total} {total === 1 ? 'horário' : 'horários'} por semana{mine.size ? ` (${mine.size} ${isAdmin ? 'já reservados' : 'já seus'} + ${picked.size} novos)` : ''}
            </Text>
            <Text style={{ fontFamily: f.title, fontSize: 26, color: c.ink }}>
              {brl(per)} cada · <Text style={{ color: c.violet }}>{brl(total * per)}/mês</Text>
            </Text>
            {couponQuote ? (
              <Text style={[s.body, { color: c.ok, marginTop: 2 }]}>
                Cupom {couponQuote.coupon_code}: − {brl(couponQuote.discount_cents)} · a pagar agora {brl(couponQuote.pay_cents)}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={[s.muted, { paddingHorizontal: 24 }]}>Toque nos horários livres para simular o valor.</Text>
        )}
        {isAdmin && (teacher || internal) && picked.size > 0 ? (
          <View style={{ paddingHorizontal: 24, marginTop: 4 }}>
            <Field name={internal ? 'Custo destes horários (R$), opcional' : 'Valor manual desta cobrança (R$)'} value={manual} onChangeText={setManual}
              keyboardType="decimal-pad"
              placeholder={internal ? 'Vazio = sem custo' : 'Vazio = automático · 0 = não cobrar'} />
            <Field name="Descrição (opcional)" value={note} onChangeText={setNote} autoCapitalize="sentences"
              placeholder="Ex.: Evento, aula particular" />
          </View>
        ) : null}
        {isTeacher && picked.size > 0 ? (
          <View style={{ paddingHorizontal: 24, marginTop: 4 }}>
            {couponQuote ? (
              <Pressable onPress={removeCoupon}>
                <Text style={{ fontFamily: f.regular, fontSize: 12, color: c.ink2, letterSpacing: 1 }}>REMOVER CUPOM</Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput value={couponInput} onChangeText={(v) => { setCouponInput(v.toUpperCase()); setCouponError(''); }}
                  placeholder="Cupom de desconto (opcional)" placeholderTextColor={c.lilac} autoCapitalize="characters"
                  autoCorrect={false} style={{ flex: 1, fontFamily: f.light, fontSize: 15, color: c.ink,
                    borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 6 }} />
                <Pressable onPress={() => applyCoupon()} disabled={!couponInput.trim()}
                  style={{ opacity: couponInput.trim() ? 1 : 0.4 }}>
                  <Text style={{ fontFamily: f.regular, fontSize: 13, color: c.violet, letterSpacing: 1 }}>APLICAR</Text>
                </Pressable>
              </View>
            )}
            {couponError ? <Text style={[s.body, { color: c.bad, fontSize: 13, marginTop: 4 }]}>{couponError}</Text> : null}
          </View>
        ) : null}
        {picked.size > 0 && (
          <Button
            text={!user ? 'Criar conta e fechar plano' : busy ? 'Fechando…' : isAdmin ? 'Reservar horários' : 'Fechar e enviar pelo WhatsApp'}
            onPress={confirm} disabled={busy} />
        )}
      </View>
    </View>
  );
}

function Legend({ color, border, text }: { color: string; border: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color, borderWidth: 1, borderColor: border }} />
      <Text style={[s.muted, { fontSize: 12 }]}>{text}</Text>
    </View>
  );
}

const chip = {
  base: { borderWidth: 1, borderColor: c.lilac, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  text: { fontFamily: f.regular, fontSize: 13, letterSpacing: 1, color: c.ink },
} as const;

const slot = {
  base: { borderWidth: 1, borderColor: c.lilac, borderRadius: 10, paddingVertical: 10, width: 76, alignItems: 'center', backgroundColor: c.white },
  text: { fontFamily: f.regular, fontSize: 14, color: c.ink },
  taken: { backgroundColor: c.sand, borderColor: c.line },
  mine: { backgroundColor: c.lavender, borderColor: c.violet },
  picked: { backgroundColor: c.violet, borderColor: c.violet },
} as const;

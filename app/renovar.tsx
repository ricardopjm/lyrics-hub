import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/lib/auth';
import { Quote, WEEKDAYS, brl, getRenewalQuote, listSlots, renewPlan } from '../src/lib/data';
import { notify } from '../src/notify';
import { buildOrderMessage, openWhatsApp } from '../src/whatsapp';
import { c, f, label } from '../src/theme';
import { Button, Field, s } from '../src/ui';

const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return n.charAt(0).toUpperCase() + n.slice(1);
};

function Row({ left, right, strong, tone }: { left: string; right: string; strong?: boolean; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={[s.body, strong && { fontFamily: f.regular }, tone ? { color: tone } : null]}>{left}</Text>
      <Text style={[s.body, strong && { fontFamily: f.regular }, tone ? { color: tone } : null]}>{right}</Text>
    </View>
  );
}

// Resumo do que o professor está comprando, com campo de cupom, antes de confirmar a renovação.
export default function Renovar() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [code, setCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Quote | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async (withCode?: string) => {
    if (!user) return;
    try {
      const q = await getRenewalQuote(user, withCode);
      setQuote(q); setError(''); setCouponError('');
      return q;
    } catch (e: any) {
      if (withCode) setCouponError(e.message); else setError(e.message);
    }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  if (!ready) return null;
  if (user?.role !== 'teacher') return <Redirect href="/" />;

  const apply = async () => {
    if (!code.trim()) return;
    setBusy(true);
    await load(code);
    setBusy(false);
  };

  const removeCoupon = async () => { setCode(''); await load(); };

  const confirm = async () => {
    if (!user || !quote) return;
    setBusy(true); setError('');
    try {
      await renewPlan(user, quote.coupon_code ?? undefined);
      const slots = (await listSlots(user)).map((x) => `${WEEKDAYS[x.weekday]} ${x.start}`);
      const text = buildOrderMessage({
        name: user.name, kind: 'renovacao', monthLabel: monthName(quote.cycle), slots, count: quote.count,
        perSlotCents: quote.per_slot_cents, subtotalCents: quote.subtotal_cents, discountCents: quote.discount_cents,
        couponCode: quote.coupon_code, totalCents: quote.total_cents,
      });
      setMessage(text);
      setDone(quote);
      try { await openWhatsApp(text); } catch (e: any) { notify('WhatsApp', e.message); }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const month = quote ? monthName(quote.cycle) : '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
        <Text onPress={() => router.back()} style={[label, { color: c.violet, marginBottom: 12 }]}>← Voltar</Text>
        <Text style={label}>Renovação do plano</Text>
        <Text style={{ fontFamily: f.title, fontSize: 38, color: c.ink, lineHeight: 42 }}>
          Resumo <Text style={{ fontFamily: f.titleItalic, color: c.violet }}>do pedido.</Text>
        </Text>
      </View>

      {done ? (
        <View style={{ marginHorizontal: 24, backgroundColor: c.lavender, borderRadius: 14, padding: 20 }}>
          <Text style={{ fontFamily: f.title, fontSize: 28, color: c.ink }}>Plano de {month} renovado.</Text>
          <Text style={[s.body, { marginTop: 8 }]}>
            {done.total_cents === 0
              ? 'Nada a pagar. O seu cupom cobriu o valor todo. Envie o pedido pelo WhatsApp para a Lyrics saber.'
              : `Valor final: ${brl(done.total_cents)}. Envie o pedido pelo WhatsApp e a Lyrics responde com o código Pix.`}
          </Text>
          <View style={{ marginHorizontal: -24, marginTop: 8 }}>
            <Button text="Enviar pedido pelo WhatsApp" onPress={() => openWhatsApp(message).catch((e) => notify('WhatsApp', e.message))} />
            <Button text="Voltar ao início" kind="line" onPress={() => router.replace('/')} />
          </View>
        </View>
      ) : (
        <>
          {error ? <Text style={[s.body, { color: c.bad, paddingHorizontal: 24, marginBottom: 12 }]}>{error}</Text> : null}
          {!quote && !error ? <Text style={[s.muted, { paddingHorizontal: 24 }]}>Carregando…</Text> : null}

          {quote ? (
            <>
              <View style={{ marginHorizontal: 24, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <Text style={[label, { marginBottom: 8 }]}>{month}</Text>
                <Row left={`Plano mensal · ${quote.count} ${quote.count === 1 ? 'horário' : 'horários'} por semana`} right="" />
                <Row left={`${quote.count} × ${brl(quote.per_slot_cents)}`} right={brl(quote.subtotal_cents)} />
                <View style={{ height: 1, backgroundColor: c.line, marginVertical: 6 }} />
                <Row left="Subtotal" right={brl(quote.subtotal_cents)} />
                {quote.coupon_code ? (
                  <View>
                    <Row left={`Cupom ${quote.coupon_code}`} right={`− ${brl(quote.discount_cents)}`} tone={c.ok} />
                    <Pressable onPress={removeCoupon}>
                      <Text style={{ fontFamily: f.regular, fontSize: 12, color: c.ink2, letterSpacing: 1 }}>REMOVER CUPOM</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={{ height: 1, backgroundColor: c.line, marginVertical: 10 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={label}>Total</Text>
                  <Text style={{ fontFamily: f.title, fontSize: 36, color: c.violet }}>{brl(quote.total_cents)}</Text>
                </View>
              </View>

              {!quote.coupon_code ? (
                <View style={{ paddingHorizontal: 24 }}>
                  <Field name="Cupom de desconto" value={code}
                    onChangeText={(v) => { setCode(v.toUpperCase()); setCouponError(''); }}
                    autoCapitalize="characters" placeholder="Digite o código" />
                  {couponError ? <Text style={[s.body, { color: c.bad, marginTop: -8, marginBottom: 8 }]}>{couponError}</Text> : null}
                  <View style={{ marginHorizontal: -24 }}>
                    <Button text="Aplicar cupom" kind="line" onPress={apply} disabled={busy || !code.trim()} />
                  </View>
                </View>
              ) : null}

              <View style={{ marginTop: 12 }}>
                <Button text={busy ? 'Confirmando…' : 'Confirmar e enviar pelo WhatsApp'} onPress={confirm} disabled={busy} />
                <Text style={[s.muted, { textAlign: 'center', marginTop: 8, fontSize: 13, paddingHorizontal: 24 }]}>
                  Vamos abrir o WhatsApp da Lyrics com o seu pedido. O código Pix é enviado por lá.
                </Text>
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

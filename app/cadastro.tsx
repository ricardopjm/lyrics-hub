import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pricePerSlot } from '../src/config';
import { Pick2, SignupQuote, WEEKDAYS, brl, signupQuote, signupTeacher } from '../src/lib/data';
import { notify } from '../src/notify';
import { c, f, label } from '../src/theme';
import { Button, Field, s } from '../src/ui';
import { buildOrderMessage, openWhatsApp } from '../src/whatsapp';

// Pública: o professor novo cria o cadastro e fecha o primeiro plano. A conta só é liberada
// depois que a Lyrics confirmar o pagamento.
export default function Cadastro() {
  const { picks: raw } = useLocalSearchParams<{ picks?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const picks: Pick2[] = useMemo(() => {
    try { const p = JSON.parse(String(raw ?? '[]')); return Array.isArray(p) ? p : []; } catch { return []; }
  }, [raw]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [quote, setQuote] = useState<SignupQuote | null>(null);
  const [couponError, setCouponError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // texto do pedido, depois de criar a conta

  const count = picks.length;
  const per = pricePerSlot(count);
  const gross = count * per;
  const discount = quote?.discount_cents ?? 0;
  const total = gross - discount;
  const slotText = picks.map((p) => `${WEEKDAYS[p.weekday]} ${p.start}`);

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setBusy(true);
    try { setQuote(await signupQuote(picks, couponInput)); setCouponError(''); }
    catch (e: any) { setQuote(null); setCouponError(e.message); }
    setBusy(false);
  };
  const removeCoupon = () => { setQuote(null); setCouponInput(''); setCouponError(''); };

  const submit = async () => {
    setError('');
    if (name.trim().length < 3) return setError('Informe o seu nome completo.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Informe um e-mail válido.');
    if (password.length < 8) return setError('A senha precisa ter ao menos 8 caracteres.');
    setBusy(true);
    try {
      const res = await signupTeacher({
        name: name.trim(), email: email.trim(), phone: phone.trim(), password, picks, coupon: quote?.coupon_code ?? '',
      });
      const text = buildOrderMessage({
        name: name.trim(), kind: 'cadastro', email: email.trim().toLowerCase(), slots: slotText, count: res.count,
        perSlotCents: res.per_slot_cents, subtotalCents: res.total_cents, discountCents: res.discount_cents,
        couponCode: res.coupon_code, totalCents: res.charged_cents,
      });
      setSent(text);
      setPassword('');
      try { await openWhatsApp(text); } catch (e: any) { notify('WhatsApp', e.message); }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 48 }}>
      <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
        <Text onPress={() => router.back()} style={[label, { color: c.violet, marginBottom: 12 }]}>← Voltar</Text>
        <Text style={label}>Primeiro plano</Text>
        <Text style={{ fontFamily: f.title, fontSize: 38, color: c.ink, lineHeight: 42 }}>
          Crie sua <Text style={{ fontFamily: f.titleItalic, color: c.violet }}>conta.</Text>
        </Text>
      </View>

      {sent ? (
        <View style={{ marginHorizontal: 24, backgroundColor: c.lavender, borderRadius: 14, padding: 20 }}>
          <Text style={{ fontFamily: f.title, fontSize: 28, color: c.ink }}>Cadastro enviado.</Text>
          <Text style={[s.body, { marginTop: 8 }]}>
            Envie o pedido pelo WhatsApp e a Lyrics responde com o código Pix. Quando o pagamento for confirmado,
            o seu acesso é liberado e você entra com o e-mail e a senha que acabou de criar.
          </Text>
          <View style={{ marginHorizontal: -24, marginTop: 8 }}>
            <Button text="Enviar pedido pelo WhatsApp" onPress={() => openWhatsApp(sent).catch((e) => notify('WhatsApp', e.message))} />
            <Button text="Ir para o login" kind="line" onPress={() => router.replace('/login')} />
          </View>
        </View>
      ) : count === 0 ? (
        <View style={{ paddingHorizontal: 24 }}>
          <Text style={s.body}>Escolha os horários antes de criar a conta.</Text>
          <View style={{ marginHorizontal: -24, marginTop: 8 }}>
            <Button text="Ver horários disponíveis" onPress={() => router.replace('/disponibilidade')} />
          </View>
        </View>
      ) : (
        <>
          {/* resumo do pedido */}
          <View style={{ marginHorizontal: 24, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 16, marginBottom: 20 }}>
            <Text style={[label, { marginBottom: 8 }]}>Seu pedido</Text>
            <Text style={s.body}>{count} {count === 1 ? 'horário' : 'horários'} por semana</Text>
            <Text style={[s.muted, { marginBottom: 8 }]}>{slotText.join(' · ')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.body}>{count} × {brl(per)}</Text>
              <Text style={s.body}>{brl(gross)}</Text>
            </View>
            {quote ? (
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[s.body, { color: c.ok }]}>Cupom {quote.coupon_code}</Text>
                  <Text style={[s.body, { color: c.ok }]}>− {brl(discount)}</Text>
                </View>
                <Pressable onPress={removeCoupon}>
                  <Text style={{ fontFamily: f.regular, fontSize: 12, color: c.ink2, letterSpacing: 1, marginTop: 4 }}>REMOVER CUPOM</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={{ height: 1, backgroundColor: c.line, marginVertical: 10 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={label}>Total</Text>
              <Text style={{ fontFamily: f.title, fontSize: 34, color: c.violet }}>{brl(total)}</Text>
            </View>
          </View>

          {/* cupom */}
          {!quote ? (
            <View style={{ paddingHorizontal: 24 }}>
              <Field name="Cupom de desconto (opcional)" value={couponInput}
                onChangeText={(v) => { setCouponInput(v.toUpperCase()); setCouponError(''); }}
                autoCapitalize="characters" placeholder="Digite o código" />
              {couponError ? <Text style={[s.body, { color: c.bad, marginTop: -8, marginBottom: 8 }]}>{couponError}</Text> : null}
              <View style={{ marginHorizontal: -24, marginBottom: 16 }}>
                <Button text="Aplicar cupom" kind="line" onPress={applyCoupon} disabled={busy || !couponInput.trim()} />
              </View>
            </View>
          ) : null}

          {/* dados da conta */}
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={[label, { marginBottom: 8 }]}>Seus dados</Text>
            <Field name="Nome completo" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field name="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field name="Telefone (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Field name="Crie uma senha (mín. 8 caracteres)" value={password} onChangeText={setPassword} secureTextEntry />
            {error ? <Text style={[s.body, { color: c.bad, marginBottom: 8 }]}>{error}</Text> : null}
            <Text style={[s.muted, { fontSize: 13 }]}>
              O seu acesso é liberado depois que a Lyrics confirmar o pagamento. Os horários ficam reservados para você até lá.
            </Text>
          </View>
          <Button text={busy ? 'Enviando…' : 'Confirmar e enviar pelo WhatsApp'} onPress={submit} disabled={busy} />
        </>
      )}
    </ScrollView>
  );
}

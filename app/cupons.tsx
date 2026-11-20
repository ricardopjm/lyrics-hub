import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/lib/auth';
import { Coupon, brl, createCoupon, listCoupons, setCouponActive } from '../src/lib/data';
import { c, f, label } from '../src/theme';
import { Button, Card, Chip, Field, s } from '../src/ui';

const describe = (k: Coupon) => (k.kind === 'percent' ? `${k.value}% de desconto` : `${brl(k.value)} de desconto`);
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

// "31/12/2026" -> "2026-12-31" (ou null se inválida)
function parseDate(txt: string): string | null {
  const m = txt.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

// Apenas administradores: criar e ativar/desativar cupons de desconto.
export default function Cupons() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Coupon[]>([]);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [expires, setExpires] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { listCoupons().then(setList).catch((e) => setError(e.message)); }, []);
  useFocusEffect(load);

  if (!ready) return null;
  if (user?.role !== 'admin') return <Redirect href="/" />;

  const save = async () => {
    setError('');
    const clean = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{3,20}$/.test(clean)) return setError('O código deve ter de 3 a 20 letras ou números, sem espaços.');
    const num = parseFloat(value.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) return setError('Informe um valor de desconto maior que zero.');
    let v: number;
    if (kind === 'percent') {
      if (!Number.isInteger(num) || num > 100) return setError('A porcentagem deve ser um número inteiro de 1 a 100.');
      v = num;
    } else {
      v = Math.round(num * 100);
    }
    let exp: string | null = null;
    if (expires.trim()) {
      exp = parseDate(expires);
      if (!exp) return setError('Validade inválida. Use o formato 31/12/2026.');
    }
    let max: number | null = null;
    if (maxUses.trim()) {
      max = Number(maxUses);
      if (!Number.isInteger(max) || max <= 0) return setError('O limite de usos deve ser um número inteiro maior que zero.');
    }
    setBusy(true);
    try {
      await createCoupon({ code: clean, kind, value: v, expires_at: exp, max_uses: max });
      setCode(''); setValue(''); setExpires(''); setMaxUses('');
      load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const toggle = async (k: Coupon) => {
    try { await setCouponActive(k.id, !k.active); load(); } catch (e: any) { setError(e.message); }
  };

  const seg = (id: 'percent' | 'fixed', text: string) => (
    <Pressable onPress={() => setKind(id)} style={{
      flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, borderWidth: 1,
      borderColor: kind === id ? c.violet : c.lilac, backgroundColor: kind === id ? c.violet : c.white }}>
      <Text style={{ fontFamily: f.regular, fontSize: 13, color: kind === id ? c.white : c.ink }}>{text}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
        <Text onPress={() => router.back()} style={[label, { color: c.violet, marginBottom: 12 }]}>← Voltar</Text>
        <Text style={label}>Somente administradores</Text>
        <Text style={{ fontFamily: f.title, fontSize: 38, color: c.ink, lineHeight: 42 }}>
          Cupons de <Text style={{ fontFamily: f.titleItalic, color: c.violet }}>desconto.</Text>
        </Text>
      </View>

      <View style={{ paddingHorizontal: 24 }}>
        <Text style={[label, { marginBottom: 8 }]}>Novo cupom</Text>
        <Field name="Código" value={code} onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters" placeholder="Ex.: NATAL10" />
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {seg('percent', 'Porcentagem (%)')}
          {seg('fixed', 'Valor em R$')}
        </View>
        <Field name={kind === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} value={value}
          onChangeText={setValue} keyboardType="decimal-pad" placeholder={kind === 'percent' ? 'Ex.: 10' : 'Ex.: 50'} />
        <Field name="Validade (opcional)" value={expires} onChangeText={setExpires}
          keyboardType="numbers-and-punctuation" placeholder="31/12/2026" />
        <Field name="Limite de usos (opcional)" value={maxUses} onChangeText={setMaxUses}
          keyboardType="number-pad" placeholder="Vazio = sem limite" />
        {error ? <Text style={[s.body, { color: c.bad, marginBottom: 8 }]}>{error}</Text> : null}
        <Text style={[s.muted, { fontSize: 13 }]}>Cada professor usa o mesmo cupom uma vez.</Text>
      </View>
      <Button text={busy ? 'Salvando…' : 'Criar cupom'} onPress={save} disabled={busy || !code || !value} />

      <Text style={[label, { paddingHorizontal: 24, marginTop: 32, marginBottom: 12 }]}>Cupons criados</Text>
      {list.length === 0 ? <Text style={[s.muted, { paddingHorizontal: 24 }]}>Nenhum cupom ainda.</Text> : null}
      {list.map((k) => (
        <Card key={k.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: f.title, fontSize: 26, color: c.ink }}>{k.code}</Text>
            <Chip text={k.active ? 'ATIVO' : 'DESATIVADO'} tone={k.active ? 'ok' : 'bad'} />
          </View>
          <Text style={s.body}>{describe(k)}</Text>
          <Text style={s.muted}>
            {k.max_uses ? `${k.uses} de ${k.max_uses} usos` : `${k.uses} ${k.uses === 1 ? 'uso' : 'usos'}`}
            {k.expires_at ? ` · válido até ${fmtDate(k.expires_at)}` : ' · sem validade'}
          </Text>
          <Text onPress={() => toggle(k)}
            style={{ fontFamily: f.regular, color: k.active ? c.bad : c.violet, fontSize: 13, letterSpacing: 1, marginTop: 12 }}>
            {k.active ? 'DESATIVAR CUPOM' : 'ATIVAR CUPOM'}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}

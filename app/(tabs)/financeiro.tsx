import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/lib/auth';
import { brl, Charge, confirmOrder, listCharges, listOrders, markPaid, Order, rejectOrder, WEEKDAYS } from '../../src/lib/data';
import { confirmAction, notify } from '../../src/notify';
import { c, f, label } from '../../src/theme';
import { Button, Card, Chip, Header, s } from '../../src/ui';

const TONE = { pending: 'warn', paid: 'ok', overdue: 'bad' } as const;
const TEXT = { pending: 'A RECEBER', paid: 'PAGO', overdue: 'ATRASADO' } as const;

export default function Financeiro() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Charge[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [choosing, setChoosing] = useState<string | null>(null);
  const load = useCallback(() => {
    listCharges().then((l) => setList([...l])).catch(() => {});
    listOrders().then(setOrders).catch(() => {});
  }, []);
  useFocusEffect(load);

  if (!ready) return null;
  if (user?.role !== 'admin') return <Redirect href="/" />;

  const received = list.filter((x) => x.status === 'paid').reduce((a, x) => a + x.cents, 0);
  const open = list.filter((x) => x.status !== 'paid').reduce((a, x) => a + x.cents, 0);

  // Pedidos de professores aguardando conferência ficam só na fila; o resto vai para a lista normal.
  const queued = new Set(orders.map((o) => o.id));
  const others = list.filter((x) => !queued.has(x.id));

  const when = (iso: string) => new Date(iso).toLocaleDateString('pt-BR') + ' ' +
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const approve = async (o: Order) => {
    const ok = await confirmAction(
      o.signup ? `Liberar o cadastro de ${o.teacher}?` : `Confirmar o pagamento de ${o.teacher}?`,
      (o.amount_cents === 0
        ? 'Nenhum pagamento é necessário (cupom de 100%). '
        : `Confirme que o Pix de ${brl(o.amount_cents)} caiu na conta. O valor passa a contar como recebido no Financeiro. `)
        + (o.signup ? 'O acesso ao sistema é liberado agora.' : ''),
      'Confirmar');
    if (!ok) return;
    try { await confirmOrder(o.id); load(); } catch (e: any) { notify('Não foi possível confirmar', e.message); }
  };

  const reject = async (o: Order) => {
    const ok = await confirmAction(`Recusar o pedido de ${o.teacher}?`,
      o.kind === 'novo'
        ? (o.signup ? 'Os horários voltam a ficar livres e o cadastro continua sem acesso ao sistema.'
          : 'Os horários desse pedido voltam a ficar livres e o cupom, se houver, é devolvido ao professor.')
        : 'A renovação é cancelada e o cupom, se houver, é devolvido ao professor.',
      'Recusar');
    if (!ok) return;
    try { await rejectOrder(o.id); load(); } catch (e: any) { notify('Não foi possível recusar', e.message); }
  };

  // Forma de recebimento escolhida na própria tela (funciona no celular e na web).
  const pay = async (id: string, m: 'pix' | 'machine') => {
    try { await markPaid(id, m); setChoosing(null); load(); }
    catch (e: any) { notify('Não foi possível registrar', e.message); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
      <Header eyebrow="Somente administradores" title="Seu" em="financeiro." />
      <View style={{ flexDirection: 'row', paddingHorizontal: 24, gap: 12, marginBottom: 16 }}>
        <View style={{ flex: 1, backgroundColor: c.lavender, borderRadius: 14, padding: 16 }}>
          <Text style={label}>Recebido</Text>
          <Text style={{ fontFamily: f.title, fontSize: 28, color: c.ink }}>{brl(received)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: c.sand, borderRadius: 14, padding: 16 }}>
          <Text style={label}>A receber</Text>
          <Text style={{ fontFamily: f.title, fontSize: 28, color: c.ink }}>{brl(open)}</Text>
        </View>
      </View>

      {orders.length > 0 ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={[label, { paddingHorizontal: 24, marginBottom: 4, color: c.warn }]}>
            Aguardando confirmação · {orders.length}
          </Text>
          <Text style={[s.muted, { paddingHorizontal: 24, marginBottom: 12, fontSize: 13 }]}>
            Confira se o Pix caiu e o comprovante enviado antes de confirmar.
          </Text>
          {orders.map((o) => (
            <Card key={o.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[s.body, { fontSize: 18 }]}>{o.teacher}</Text>
                <Chip text={o.signup ? 'NOVO PROFESSOR' : o.kind === 'renovacao' ? 'RENOVAÇÃO' : 'NOVO PLANO'} tone="violet" />
              </View>
              {o.signup ? (
                <Text style={s.muted}>{o.email}{o.phone ? ` · ${o.phone}` : ''}</Text>
              ) : null}
              {o.kind === 'novo' && o.slots.length > 0 ? (
                <Text style={s.muted}>{o.slots.map((x) => `${WEEKDAYS[x.weekday].slice(0, 3)} ${x.start}`).join(' · ')}</Text>
              ) : null}
              {o.kind === 'renovacao' ? <Text style={s.muted}>Plano do mês {o.cycle.split('-').reverse().join('/')}</Text> : null}
              {o.coupon_code ? (
                <Text style={[s.muted, { color: c.ok }]}>Cupom {o.coupon_code} · − {brl(o.discount_cents)}</Text>
              ) : null}
              <Text style={{ fontFamily: f.title, fontSize: 32, color: c.violet, marginTop: 4 }}>{brl(o.amount_cents)}</Text>
              <Text style={[s.muted, { fontSize: 12 }]}>Pedido em {when(o.created_at)}</Text>
              <View style={{ marginHorizontal: -24, marginTop: 4 }}>
                <Button text="Confirmar pagamento" onPress={() => approve(o)} />
              </View>
              <Text onPress={() => reject(o)}
                style={{ fontFamily: f.regular, color: c.bad, fontSize: 13, letterSpacing: 1, marginTop: 14, textAlign: 'center' }}>
                RECUSAR PEDIDO
              </Text>
            </Card>
          ))}
        </View>
      ) : null}

      <Button text="Cupons de desconto" kind="line" onPress={() => router.push('/cupons')} />
      <View style={{ height: 16 }} />
      {others.map((x) => (
        <Card key={x.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[s.body, { fontSize: 18 }]}>{x.teacher}</Text>
            <Chip text={TEXT[x.status]} tone={TONE[x.status]} />
          </View>
          {x.note ? <Text style={[s.body, { color: c.violet, marginBottom: 2 }]}>{x.note}</Text> : null}
          <Text style={s.muted}>{brl(x.cents)} · vence {x.due.split('-').reverse().join('/')}
            {x.method ? ` · ${x.method === 'pix' ? 'Pix' : 'Máquina'}` : ''}</Text>
          {x.status !== 'paid' && (choosing === x.id ? (
            <View style={{ marginTop: 12 }}>
              <Text style={[label, { marginBottom: 8 }]}>Como foi recebido?</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([['pix', 'Pix'], ['machine', 'Máquina']] as const).map(([m, name]) => (
                  <Pressable key={m} onPress={() => pay(x.id, m)} style={{
                    flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: c.violet }}>
                    <Text style={{ fontFamily: f.regular, color: c.white }}>{name}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setChoosing(null)} style={{
                  flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.violet }}>
                  <Text style={{ fontFamily: f.regular, color: c.violet }}>Cancelar</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ marginHorizontal: -24, marginTop: 8 }}>
              <Button text="Registrar recebimento" kind="line" onPress={() => setChoosing(x.id)} />
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

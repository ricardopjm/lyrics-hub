import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bars, Ring, WeekGrid, studentColors } from '../../src/charts';
import { useAuth } from '../../src/lib/auth';
import { AdminDash, Dash, TeacherDash, brl, getDashboard, getMyPendingOrders, getMyPlan, listOrders } from '../../src/lib/data';
import { c, f, label } from '../../src/theme';
import { Button, Card, Header, s } from '../../src/ui';

const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Stat({ title, value, sub, tint = c.lavender }: { title: string; value: string; sub?: string; tint?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: tint, borderRadius: 14, padding: 16 }}>
      <Text style={label}>{title}</Text>
      <Text style={{ fontFamily: f.title, fontSize: 32, color: c.ink, lineHeight: 38 }}>{value}</Text>
      {sub ? <Text style={[s.muted, { fontSize: 12 }]}>{sub}</Text> : null}
    </View>
  );
}

export default function Inicio() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!user) return;
    getDashboard(user).then((d) => { setDash(d); setError(''); }).catch((e) => setError(e.message));
  }, [user]);
  useFocusEffect(load);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
      <Header eyebrow={`Olá, ${user?.name.split(' ')[0] ?? ''}`} title="Seu" em="resumo." />
      {error ? <Text style={[s.body, { color: c.bad, paddingHorizontal: 24 }]}>{error}</Text> : null}
      {!dash && !error ? <Text style={[s.muted, { paddingHorizontal: 24 }]}>Carregando…</Text> : null}
      {dash?.role === 'teacher' ? <TeacherHome d={dash} reload={load} /> : null}
      {dash?.role === 'admin' ? <AdminHome d={dash} /> : null}
    </ScrollView>
  );
}

function TeacherHome({ d }: { d: TeacherDash; reload: () => void }) {
  const router = useRouter();
  const colorOf = useMemo(() => studentColors(d.slots.map((x) => x.student)), [d.slots]);
  const [pending, setPending] = useState<{ count: number; total_cents: number } | null>(null);
  useEffect(() => { getMyPendingOrders().then(setPending).catch(() => {}); }, [d]);
  const [plan, setPlan] = useState<{ plan_until: string | null; expired: boolean; has_slots: boolean } | null>(null);
  useEffect(() => { getMyPlan().then(setPlan).catch(() => {}); }, [d]);

  // alunos e quantos horários por semana cada um tem
  const legend = useMemo(() => {
    const m = new Map<string, number>();
    let none = 0;
    d.slots.forEach((x) => (x.student?.trim() ? m.set(x.student, (m.get(x.student) ?? 0) + 1) : none++));
    return { list: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])), none };
  }, [d.slots]);

  const left = Math.max(d.planned - d.done - d.missed, 0);
  const nextName = monthName(d.next_cycle);


  return (
    <>
      {plan?.expired ? (
        <View style={{ marginHorizontal: 24, marginBottom: 12, padding: 16, borderRadius: 14, backgroundColor: c.lavender, borderWidth: 1, borderColor: c.violet }}>
          <Text style={[label, { color: c.violet }]}>Plano vencido</Text>
          <Text style={[s.body, { marginTop: 4 }]}>
            Seu plano terminou em {plan.plan_until ? plan.plan_until.split('-').reverse().join('/') : ''}. Seus alunos, históricos e relatórios continuam aqui.
            Contrate um novo plano para voltar a ter horários.
          </Text>
          <View style={{ marginHorizontal: -24, marginTop: 4 }}>
            <Button text="Contratar novo plano" onPress={() => router.push('/horarios')} />
          </View>
        </View>
      ) : null}
      {pending && pending.count > 0 ? (
        <View style={{ marginHorizontal: 24, marginBottom: 12, padding: 16, borderRadius: 14, backgroundColor: c.sand, borderWidth: 1, borderColor: c.warn }}>
          <Text style={[label, { color: c.warn }]}>Aguardando confirmação</Text>
          <Text style={[s.body, { marginTop: 4 }]}>
            {pending.count === 1 ? 'Seu pedido' : `Seus ${pending.count} pedidos`} de {brl(pending.total_cents)} {pending.count === 1 ? 'está' : 'estão'} aguardando a Lyrics confirmar o pagamento.
          </Text>
        </View>
      ) : null}
      {/* progresso do mês */}
      <Card>
        <Text style={[label, { marginBottom: 12 }]}>{monthName(d.month)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
          <Ring value={d.done} total={d.planned} big={`${d.done}/${d.planned}`} small="aulas" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: f.title, fontSize: 26, color: c.ink, lineHeight: 30 }}>
              {d.planned === 0
                ? 'Sem aulas previstas.'
                : left === 0 ? 'Aulas do mês completas.'
                : left === 1 ? 'Falta 1 aula.' : `Faltam ${left} aulas.`}
            </Text>
            <Text style={[s.muted, { marginTop: 6 }]}>
              Você deu {plural(d.done, 'aula', 'aulas')}
              {d.missed > 0 ? ` e teve ${plural(d.missed, 'falta', 'faltas')}` : ''}.
            </Text>
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginBottom: 12 }}>
        <Stat title="Alunos" value={String(d.students)} sub={legend.none ? `${legend.none} sem nome` : 'ativos'} />
        <Stat title="Plano" value={String(d.slots.length)} tint={c.sand}
          sub={`${d.slots.length === 1 ? 'horário' : 'horários'} por semana`} />
      </View>

      {/* horários e alunos */}
      <Card>
        <Text style={[label, { marginBottom: 12 }]}>Sua semana</Text>
        {d.slots.length === 0
          ? <Text style={s.muted}>Você ainda não tem horários. Feche os seus na aba Horários.</Text>
          : <WeekGrid slots={d.slots} colorOf={colorOf} />}
        <View style={{ marginTop: 12, gap: 6 }}>
          {legend.list.map(([name, n]) => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: colorOf(name) }} />
              <Text style={[s.body, { flex: 1 }]}>{name}</Text>
              <Text style={s.muted}>{plural(n, 'horário', 'horários')}</Text>
            </View>
          ))}
          {legend.none > 0 ? (
            <Text style={[s.muted, { fontSize: 13, marginTop: 4 }]}>
              {plural(legend.none, 'horário', 'horários')} sem aluno. Informe o nome abrindo o horário na Agenda.
            </Text>
          ) : null}
        </View>
      </Card>

      {/* renovação */}
      {d.renewed ? (
        <Text style={[s.body, { textAlign: 'center', color: c.ok, marginTop: 8 }]}>
          Plano de {nextName} renovado.
        </Text>
      ) : (
        <>
          <Button text="Renovar plano" onPress={() => router.push('/renovar')} disabled={d.slots.length === 0} />
          {d.slots.length > 0 ? (
            <Text style={[s.muted, { textAlign: 'center', marginTop: 8, fontSize: 13 }]}>
              {nextName}: {brl(d.next_cents)} por mês
            </Text>
          ) : null}
        </>
      )}
    </>
  );
}

function AdminHome({ d }: { d: AdminDash }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(0);
  useEffect(() => { listOrders().then((o) => setWaiting(o.length)).catch(() => {}); }, [d]);
  const pct = d.capacity > 0 ? Math.round((d.occupied / d.capacity) * 100) : 0;
  const days = [1, 2, 3, 4, 5, 6];
  const names = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  return (
    <>
      {waiting > 0 ? (
        <Card onPress={() => router.push('/financeiro')}>
          <Text style={[label, { color: c.warn }]}>Aguardando confirmação</Text>
          <Text style={{ fontFamily: f.title, fontSize: 28, color: c.ink }}>
            {waiting} {waiting === 1 ? 'pedido' : 'pedidos'}
          </Text>
          <Text style={s.muted}>Confira os pagamentos no Financeiro.</Text>
        </Card>
      ) : null}
      <Card>
        <Text style={[label, { marginBottom: 12 }]}>Ocupação da sala</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
          <Ring value={d.occupied} total={d.capacity} big={`${pct}%`} small="ocupada" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: f.title, fontSize: 26, color: c.ink, lineHeight: 30 }}>
              {plural(d.occupied, 'horário ocupado', 'horários ocupados')}
            </Text>
            <Text style={[s.muted, { marginTop: 6 }]}>de {d.capacity} horários na semana.</Text>
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginBottom: 12 }}>
        <Stat title="Professores" value={String(d.teachers)} />
        <Stat title="Alunos" value={String(d.students)} tint={c.sand} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginBottom: 12 }}>
        <Stat title="Recebido no mês" value={brl(d.received_cents)} tint={c.sand} />
        <Stat title="A receber" value={brl(d.pending_cents)} />
      </View>

      <Card>
        <Text style={[label, { marginBottom: 12 }]}>Horários por dia · {plural(d.done_month, 'aula dada', 'aulas dadas')} no mês</Text>
        <Bars values={days.map((i) => d.by_weekday[i] ?? 0)} labels={names} />
      </Card>

      <Card>
        <Text style={[label, { marginBottom: 12 }]}>Hoje</Text>
        {d.today.length === 0 ? <Text style={s.muted}>Nenhuma aula hoje.</Text> : null}
        {d.today.map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, paddingVertical: 4 }}>
            <Text style={{ fontFamily: f.title, fontSize: 22, color: c.violet, width: 60 }}>{t.start}</Text>
            <Text style={[s.body, { flex: 1 }]}>{t.teacher}{t.student ? ` · ${t.student}` : ''}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

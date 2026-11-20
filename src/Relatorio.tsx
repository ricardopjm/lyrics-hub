import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ring } from './charts';
import { ReportRow, WEEKDAYS, getWeeklyReport } from './lib/data';
import { c, f, label } from './theme';
import { Card, Chip, Header, s } from './ui';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = (d: Date) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); m.setHours(12, 0, 0, 0); return m; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const short = (d: Date) => `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Relatório semanal: cada aula prevista da semana e o que foi registrado.
export default function Relatorio() {
  const router = useRouter();
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');
  const today = iso(new Date());

  useFocusEffect(useCallback(() => {
    setRows(null);
    getWeeklyReport(iso(monday)).then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message));
  }, [monday]));

  const stats = useMemo(() => {
    const r = rows ?? [];
    const done = r.filter((x) => x.status === 'aula').length;
    const missed = r.filter((x) => x.status === 'falta').length;
    const pending = r.filter((x) => !x.status && x.lesson_date <= today).length; // já passou e ninguém registrou
    const upcoming = r.filter((x) => !x.status && x.lesson_date > today).length;
    const students = new Set(r.filter((x) => x.status === 'aula' && x.student).map((x) => x.student)).size;
    return { total: r.length, done, missed, pending, upcoming, students };
  }, [rows, today]);

  const days = useMemo(() => {
    const m = new Map<string, ReportRow[]>();
    (rows ?? []).forEach((r) => m.set(r.lesson_date, [...(m.get(r.lesson_date) ?? []), r]));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const isThisWeek = iso(monday) === iso(mondayOf(new Date()));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
      <Header eyebrow="Relatório semanal" title="Suas" em="aulas." />

      {/* navegação entre semanas */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 16 }}>
        <Pressable onPress={() => setMonday(addDays(monday, -7))} hitSlop={12}>
          <Text style={{ fontFamily: f.regular, fontSize: 13, color: c.violet, letterSpacing: 1 }}>‹ ANTERIOR</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontFamily: f.title, fontSize: 24, color: c.ink }}>{short(monday)} a {short(addDays(monday, 6))}</Text>
          {isThisWeek ? <Text style={[label, { fontSize: 10 }]}>Esta semana</Text>
            : <Text onPress={() => setMonday(mondayOf(new Date()))} style={[label, { fontSize: 10, color: c.violet }]}>VOLTAR PARA ESTA SEMANA</Text>}
        </View>
        <Pressable onPress={() => setMonday(addDays(monday, 7))} hitSlop={12}>
          <Text style={{ fontFamily: f.regular, fontSize: 13, color: c.violet, letterSpacing: 1 }}>PRÓXIMA ›</Text>
        </Pressable>
      </View>

      {error ? <Text style={[s.body, { color: c.bad, paddingHorizontal: 24 }]}>{error}</Text> : null}
      {!rows && !error ? <Text style={[s.muted, { paddingHorizontal: 24 }]}>Carregando…</Text> : null}

      {rows ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
              <Ring value={stats.done} total={stats.total} size={110} stroke={11} big={`${stats.done}/${stats.total}`} small="aulas" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.body}>{plural(stats.done, 'aula dada', 'aulas dadas')}</Text>
                <Text style={[s.body, stats.missed ? { color: c.bad } : null]}>{plural(stats.missed, 'falta', 'faltas')}</Text>
                {stats.pending > 0 ? <Text style={[s.body, { color: c.warn }]}>{plural(stats.pending, 'sem registro', 'sem registro')}</Text> : null}
                {stats.upcoming > 0 ? <Text style={s.muted}>{plural(stats.upcoming, 'prevista', 'previstas')}</Text> : null}
                <Text style={s.muted}>{plural(stats.students, 'aluno atendido', 'alunos atendidos')}</Text>
              </View>
            </View>
          </Card>

          {days.length === 0 ? (
            <Text style={[s.muted, { paddingHorizontal: 24 }]}>Nenhuma aula prevista nesta semana.</Text>
          ) : null}

          {days.map(([date, list]) => {
            const d = new Date(date + 'T12:00:00');
            return (
              <View key={date}>
                <Text style={[label, { paddingHorizontal: 24, marginTop: 12, marginBottom: 8 }]}>
                  {WEEKDAYS[d.getDay()]} · {short(d)}
                </Text>
                {list.map((r) => {
                  const tone = r.status === 'aula' ? 'ok' : r.status === 'falta' ? 'bad' : r.lesson_date <= today ? 'warn' : 'violet';
                  const text = r.status === 'aula' ? 'AULA DADA' : r.status === 'falta' ? 'FALTA' : r.lesson_date <= today ? 'SEM REGISTRO' : 'PREVISTA';
                  return (
                    <Card key={r.slot_id + r.lesson_date}
                      onPress={() => router.push({ pathname: '/horario/[id]', params: { id: r.slot_id, date: r.lesson_date } })}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontFamily: f.title, fontSize: 26, color: c.ink }}>{r.start}</Text>
                        <Chip text={text} tone={tone} />
                      </View>
                      <Text style={s.body}>{r.student ?? 'Sem aluno'}</Text>
                      {r.note ? <Text style={s.muted}>{r.note}</Text> : null}
                    </Card>
                  );
                })}
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

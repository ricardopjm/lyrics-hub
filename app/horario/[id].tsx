import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/lib/auth';
import { addEvent, Event, getSlot, listEvents, listStudents, setSlotStudent, Slot, Student, WEEKDAYS } from '../../src/lib/data';
import { notify } from '../../src/notify';
import { c, f, label } from '../../src/theme';
import { Button, Card, Chip, Field, s } from '../../src/ui';

const KIND = { aula: 'AULA', falta: 'FALTA', troca: 'TROCA', obs: 'NOTA', pagamento: 'PAGAMENTO' } as const;
const TONE = { aula: 'ok', falta: 'bad', troca: 'warn', obs: 'violet', pagamento: 'ok' } as const;

// Data local em AAAA-MM-DD, com deslocamento de dias.
const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

function Choice({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      borderWidth: 1, borderColor: on ? c.violet : c.lilac, backgroundColor: on ? c.violet : c.white,
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
      <Text style={{ fontFamily: f.regular, fontSize: 13, color: on ? c.white : c.ink }}>{text}</Text>
    </Pressable>
  );
}

export default function Horario() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(0); // 0 = hoje, -1 = ontem (quando não vem uma data do relatório)

  const load = useCallback(async () => {
    if (!user) return;
    const sl = await getSlot(id, user);
    setSlot(sl);
    if (sl) {
      const list = await listStudents(sl.teacherId);
      setStudents(list);
      setStudentId(list.find((x) => x.name === sl.student)?.id ?? null);
    }
    // Professor não vê lançamentos de pagamento, só admin.
    const ev = await listEvents(id);
    setEvents(user.role === 'admin' ? ev : ev.filter((e) => e.kind !== 'pagamento'));
  }, [id, user]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const pickStudent = async (sid: string | null) => {
    try { await setSlotStudent(id, sid); await load(); }
    catch (e: any) { notify('Erro', e.message); }
  };

  const lessonDate = date ?? isoDay(when);

  const add = async (kind: Event['kind']) => {
    if (!user) return;
    try {
      await addEvent(id, kind, note.trim(), user, kind === 'aula' || kind === 'falta' ? lessonDate : undefined);
      setNote(''); await load();
    } catch (e: any) { notify('Erro', e.message); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
        <Text onPress={() => router.back()} style={[label, { color: c.violet, marginBottom: 12 }]}>← Voltar</Text>
        <Text style={label}>{slot ? `${WEEKDAYS[slot.weekday]} · ${slot.room}` : ''}</Text>
        <Text style={{ fontFamily: f.title, fontSize: 40, color: c.ink }}>
          {slot?.start} – {slot?.end}
        </Text>
        {user?.role === 'admin' && slot ? <Text style={s.muted}>{slot.teacher}</Text> : null}
      </View>

      {/* aluno do horário: escolhido entre os alunos cadastrados */}
      <View style={{ paddingHorizontal: 24, marginBottom: 24 }}>
        <Text style={[label, { marginBottom: 8 }]}>Aluno deste horário</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Choice text="Sem aluno" on={studentId === null} onPress={() => pickStudent(null)} />
          {students.map((st) => (
            <Choice key={st.id} text={st.name} on={studentId === st.id} onPress={() => pickStudent(st.id)} />
          ))}
        </View>
        {students.length === 0 ? (
          <Text style={[s.muted, { marginTop: 8 }]}>
            Nenhum aluno cadastrado. Cadastre na aba Alunos e volte aqui para escolher.
          </Text>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 24 }}>
        <Text style={[label, { marginBottom: 8 }]}>Registrar no histórico</Text>
        {date ? (
          <Text style={[s.body, { marginBottom: 12 }]}>Aula de {fmt(date)}</Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <Choice text="Hoje" on={when === 0} onPress={() => setWhen(0)} />
            <Choice text="Ontem" on={when === -1} onPress={() => setWhen(-1)} />
          </View>
        )}
        <Field name="Observação" value={note} onChangeText={setNote} placeholder="Opcional" />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1 }}><Button text="Aula dada" onPress={() => add('aula')} /></View>
        <View style={{ flex: 1 }}><Button text="Falta" kind="line" onPress={() => add('falta')} /></View>
      </View>
      <Button text="Salvar nota" kind="line" onPress={() => note && add('obs')} />

      <Text style={[label, { paddingHorizontal: 24, marginTop: 32, marginBottom: 12 }]}>Histórico</Text>
      {events.length === 0 && <Text style={[s.muted, { paddingHorizontal: 24 }]}>Nenhum registro ainda.</Text>}
      {events.map((e) => (
        <Card key={e.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Chip text={KIND[e.kind]} tone={TONE[e.kind]} />
            <Text style={s.muted}>{new Date(e.at).toLocaleDateString('pt-BR')}</Text>
          </View>
          {e.note ? <Text style={[s.body, { marginTop: 8 }]}>{e.note}</Text> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

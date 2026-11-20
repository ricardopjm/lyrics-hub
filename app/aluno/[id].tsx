import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HistoryItem, Student, addStudentNote, archiveStudent, getStudent, getStudentHistory, updateStudent } from '../../src/lib/data';
import { confirmAction, notify } from '../../src/notify';
import { c, f, label } from '../../src/theme';
import { Button, Card, Chip, Field, s } from '../../src/ui';

const TONE = { aula: 'ok', falta: 'bad', nota: 'violet' } as const;
const TEXT = { aula: 'AULA', falta: 'FALTA', nota: 'ANOTAÇÃO' } as const;
const fmt = (iso: string) => iso.split('-').reverse().join('/');

// Ficha do aluno: dados, resumo e histórico (aulas, faltas e anotações).
export default function Aluno() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [st, setSt] = useState<Student | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [obs, setObs] = useState('');
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const s1 = await getStudent(id);
      setSt(s1);
      if (s1) { setName(s1.name); setPhone(s1.phone ?? ''); setObs(s1.note ?? ''); }
      setHistory(await getStudentHistory(id));
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try { await updateStudent(id, { name, phone, note: obs }); await load(); notify('Salvo', 'Dados do aluno atualizados.'); }
    catch (e: any) { notify('Erro', e.message); }
  };

  const addEntry = async () => {
    if (!entry.trim()) return;
    try { await addStudentNote(id, entry); setEntry(''); await load(); }
    catch (e: any) { notify('Erro', e.message); }
  };

  const archive = async () => {
    const ok = await confirmAction(`Arquivar ${st?.name}?`,
      'O aluno sai da lista e dos seus horários. O histórico fica guardado.', 'Arquivar');
    if (!ok) return;
    try { await archiveStudent(id); router.back(); } catch (e: any) { notify('Erro', e.message); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: 24, marginBottom: 20 }}>
        <Text onPress={() => router.back()} style={[label, { color: c.violet, marginBottom: 12 }]}>← Voltar</Text>
        <Text style={label}>Ficha do aluno</Text>
        <Text style={{ fontFamily: f.title, fontSize: 38, color: c.ink, lineHeight: 42 }}>{st?.name ?? '…'}</Text>
        {error ? <Text style={[s.body, { color: c.bad }]}>{error}</Text> : null}
      </View>

      {st ? (
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginBottom: 24 }}>
          {[{ t: 'Horários', v: st.slots }, { t: 'Aulas dadas', v: st.done }, { t: 'Faltas', v: st.missed }].map((x) => (
            <View key={x.t} style={{ flex: 1, backgroundColor: c.lavender, borderRadius: 14, padding: 14 }}>
              <Text style={[label, { fontSize: 10 }]}>{x.t}</Text>
              <Text style={{ fontFamily: f.title, fontSize: 32, color: c.ink }}>{x.v}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 24 }}>
        <Text style={[label, { marginBottom: 8 }]}>Dados</Text>
        <Field name="Nome" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field name="Telefone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field name="Observação" value={obs} onChangeText={setObs} autoCapitalize="sentences" multiline />
      </View>
      <Button text="Salvar dados" kind="line" onPress={save} disabled={!name.trim()} />

      <View style={{ paddingHorizontal: 24, marginTop: 32 }}>
        <Text style={[label, { marginBottom: 8 }]}>Histórico do aluno</Text>
        <Field name="Nova anotação" value={entry} onChangeText={setEntry} autoCapitalize="sentences"
          placeholder="Evolução, repertório, tarefa para casa…" multiline />
      </View>
      <Button text="Adicionar ao histórico" onPress={addEntry} disabled={!entry.trim()} />

      <View style={{ marginTop: 20 }}>
        {history.length === 0 ? <Text style={[s.muted, { paddingHorizontal: 24 }]}>Nenhum registro ainda.</Text> : null}
        {history.map((h) => (
          <Card key={h.kind + h.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Chip text={TEXT[h.kind]} tone={TONE[h.kind]} />
              <Text style={s.muted}>{fmt(h.date)}</Text>
            </View>
            {h.note ? <Text style={[s.body, { marginTop: 8 }]}>{h.note}</Text> : null}
          </Card>
        ))}
      </View>

      <Text onPress={archive}
        style={{ fontFamily: f.regular, color: c.bad, fontSize: 13, letterSpacing: 1, textAlign: 'center', marginTop: 24 }}>
        ARQUIVAR ALUNO
      </Text>
    </ScrollView>
  );
}

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from './lib/auth';
import { Student, listStudents } from './lib/data';
import { c, f } from './theme';
import { Button, Card, Header, s } from './ui';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Lista dos alunos de quem está logado (professor, ou administrador que também dá aula).
export default function AlunosList() {
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<Student[] | null>(null);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    if (user) listStudents(user.id).then((l) => { setList(l); setError(''); }).catch((e) => setError(e.message));
  }, [user]));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
      <Header eyebrow={list ? plural(list.length, 'aluno', 'alunos') : 'Seus alunos'} title="Seus" em="alunos." />
      {error ? <Text style={[s.body, { color: c.bad, paddingHorizontal: 24 }]}>{error}</Text> : null}
      {list && list.length === 0 ? (
        <Text style={[s.muted, { paddingHorizontal: 24, marginBottom: 16 }]}>
          Você ainda não cadastrou nenhum aluno. Cadastre, escolha o aluno em cada horário e acompanhe o histórico de cada um.
        </Text>
      ) : null}
      {(list ?? []).map((st) => (
        <Card key={st.id} onPress={() => router.push(`/aluno/${st.id}`)}>
          <Text style={{ fontFamily: f.title, fontSize: 26, color: c.ink }}>{st.name}</Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
            <Text style={s.muted}>{plural(st.slots, 'horário', 'horários')}</Text>
            <Text style={s.muted}>{plural(st.done, 'aula dada', 'aulas dadas')}</Text>
            {st.missed > 0 ? <Text style={[s.muted, { color: c.bad }]}>{plural(st.missed, 'falta', 'faltas')}</Text> : null}
          </View>
        </Card>
      ))}
      <Button text="Cadastrar aluno" onPress={() => router.push('/aluno/novo')} />
    </ScrollView>
  );
}

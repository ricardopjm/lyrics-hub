import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/lib/auth';
import { deleteTeacher, listTeachers, Teacher } from '../../src/lib/data';
import { confirmAction, notify } from '../../src/notify';
import { c, f } from '../../src/theme';
import { Button, Card, Header, s } from '../../src/ui';

export default function Professores() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Teacher[]>([]);

  useFocusEffect(useCallback(() => { listTeachers().then(setList).catch(() => {}); }, []));

  if (!ready) return null;
  if (user?.role !== 'admin') return <Redirect href="/" />;

  const remove = async (t: Teacher) => {
    const ok = await confirmAction(
      `Excluir ${t.name}?`,
      'Ele perde o acesso ao app e os horários dele voltam a ficar livres. O histórico financeiro é mantido.',
      'Excluir');
    if (!ok) return;
    try {
      await deleteTeacher(t.id);
      setList((l) => l.filter((x) => x.id !== t.id));
    } catch (e: any) {
      notify('Não foi possível excluir', e.message ?? 'Tente novamente.');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
      <Header eyebrow="Somente administradores" title="Seus" em="professores." />
      {list.map((t) => (
        <Card key={t.id}>
          <Text style={[s.body, { fontSize: 18 }]}>{t.name}</Text>
          <Text style={s.muted}>{t.email}</Text>
          {t.phone ? <Text style={s.muted}>{t.phone}</Text> : null}
          <Text onPress={() => remove(t)}
            style={{ fontFamily: f.regular, color: c.bad, fontSize: 13, letterSpacing: 1, marginTop: 12 }}>
            EXCLUIR PROFESSOR
          </Text>
        </Card>
      ))}
      <Button text="Cadastrar novo professor" onPress={() => router.push('/professor/novo')} />
    </ScrollView>
  );
}

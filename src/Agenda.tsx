import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from './lib/auth';
import { listSlots, Slot, WEEKDAYS } from './lib/data';
import { c, f, label } from './theme';
import { Card, Header, s } from './ui';

export default function Agenda() {
  const { user } = useAuth();
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([]);

  useFocusEffect(useCallback(() => { if (user) listSlots(user).then(setSlots).catch(() => {}); }, [user]));

  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => slots.some((x) => x.weekday === d));
  const admin = user?.role === 'admin';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
      <Header eyebrow={admin ? 'Todos os horários' : `Olá, ${user?.name.split(' ')[0]}`} title="Sua" em="agenda." />
      {days.length === 0 && <Text style={[s.muted, { paddingHorizontal: 24 }]}>Nenhum horário cadastrado.</Text>}
      {days.map((d) => (
        <View key={d}>
          <Text style={[label, { paddingHorizontal: 24, marginTop: 12, marginBottom: 8 }]}>{WEEKDAYS[d]}</Text>
          {slots.filter((x) => x.weekday === d).map((x) => (
            <Card key={x.id} onPress={() => router.push(`/horario/${x.id}`)}>
              <Text style={{ fontFamily: f.title, fontSize: 28, color: c.ink }}>{x.start} – {x.end}</Text>
              <Text style={s.body}>{x.room}{admin ? ` · ${x.teacher}` : ''}</Text>
              {x.student ? <Text style={s.muted}>{x.student}</Text> : null}
            </Card>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

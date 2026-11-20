import React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STUDIO } from '../../src/config';
import { useAuth } from '../../src/lib/auth';
import { c, f, label } from '../../src/theme';
import { Button, Header, LogoL, s } from '../../src/ui';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.line }}>
      <Text style={[label, { marginBottom: 8 }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function Conta() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
      <Header eyebrow={user?.role === 'admin' ? 'Administrador' : 'Professor'} title="Sua" em="conta." />
      <Text style={[s.body, { paddingHorizontal: 24, marginBottom: 24, fontSize: 18 }]}>{user?.name}</Text>

      {/* estúdio */}
      <View style={{ paddingHorizontal: 24, paddingVertical: 24, backgroundColor: c.lavender, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <LogoL size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: f.title, fontSize: 30, color: c.ink, lineHeight: 34 }}>{STUDIO.name}</Text>
          <Text style={[s.muted, { fontFamily: f.titleItalic, fontSize: 18, color: c.violet }]}>{STUDIO.by}</Text>
        </View>
      </View>

      <Block title="Endereço">
        <Text style={s.body}>{STUDIO.address}</Text>
      </Block>

      <Block title="Horário de funcionamento">
        {STUDIO.hours.map((h) => (
          <View key={h.days} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
            <Text style={s.body}>{h.days}</Text>
            <Text style={[s.body, { color: c.violet }]}>{h.time}</Text>
          </View>
        ))}
      </Block>

      <Block title="Instagram">
        <Text onPress={() => Linking.openURL(STUDIO.instagramUrl)}
          style={[s.body, { color: c.violet }]}>{STUDIO.instagram}</Text>
      </Block>

      <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 24 }}>
        <Button text="Sair" kind="line" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Horarios from '../src/Horarios';
import { c, label } from '../src/theme';

// Pública: o professor consulta os horários livres antes mesmo de ter login.
export default function Disponibilidade() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.white, paddingTop: insets.top }}>
      <Text
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={[label, { color: c.violet, paddingHorizontal: 24, paddingTop: 12 }]}>
        ← Voltar
      </Text>
      <Horarios />
    </View>
  );
}

import { Tabs } from 'expo-router';
import React from 'react';
import { useAuth } from '../../src/lib/auth';
import { c, f } from '../../src/theme';

export default function TabsLayout() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.violet,
      tabBarInactiveTintColor: c.ink2,
      tabBarLabelStyle: { fontFamily: f.regular, fontSize: 10, letterSpacing: 0 },
      tabBarIconStyle: { display: 'none' },
      tabBarStyle: { backgroundColor: c.white, borderTopColor: c.line },
      tabBarLabelPosition: 'below-icon',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="horarios" options={{ title: 'Horários' }} />
      <Tabs.Screen name="alunos" options={{ title: 'Alunos' }} />
      {/* Professor nem enxerga estas abas: href null as remove. */}
      <Tabs.Screen name="professores" options={{ title: 'Professores', href: admin ? undefined : null }} />
      <Tabs.Screen name="financeiro" options={{ title: 'Financeiro', href: admin ? undefined : null }} />
      <Tabs.Screen name="conta" options={{ title: 'Conta' }} />
    </Tabs>
  );
}

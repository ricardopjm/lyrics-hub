import { CormorantGaramond_300Light, CormorantGaramond_300Light_Italic } from '@expo-google-fonts/cormorant-garamond';
import { Jost_300Light, Jost_400Regular } from '@expo-google-fonts/jost';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { c } from '../src/theme';

SplashScreen.preventAutoHideAsync();

function Guard() {
  const { user, ready } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === 'login';
    const isPublic = segments[0] === 'disponibilidade' || segments[0] === 'cadastro'; // grade de horários e cadastro: sem login
    if (!user && !onLogin && !isPublic) router.replace('/login');
    if (user && onLogin) router.replace('/');
  }, [user, ready, segments]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.white } }}>
      <Stack.Screen name="professor/novo" options={{ presentation: 'modal' }} />
      <Stack.Screen name="renovar" />
      <Stack.Screen name="cadastro" />
      <Stack.Screen name="aluno/novo" options={{ presentation: 'modal' }} />
      <Stack.Screen name="aluno/[id]" />
      <Stack.Screen name="cupons" />
    </Stack>
  );
}

export default function Root() {
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_300Light, CormorantGaramond_300Light_Italic, Jost_300Light, Jost_400Regular,
  });
  // Se as fontes demorarem ou falharem, abre o app mesmo assim (com a fonte padrão) em vez de tela branca.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 4000); return () => clearTimeout(t); }, []);
  const ready = fontsLoaded || !!fontError || waited;
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Guard />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

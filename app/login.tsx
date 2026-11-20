import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/lib/auth';
import { notify } from '../src/notify';
import { DEMO } from '../src/lib/supabase';
import { c, f, label } from '../src/theme';
import { Button, Field, LogoL } from '../src/ui';

export default function Login() {
  const { signIn, signInDemo } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try { await signIn(email.trim(), password); }
    catch (e: any) { notify('Não foi possível entrar', e.message); }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.white, paddingTop: insets.top + 48 }}>
      <View style={{ paddingHorizontal: 24 }}>
        <LogoL size={48} />
        <Text style={[label, { marginTop: 32 }]}>Lyrics Hub</Text>
        <Text style={{ fontFamily: f.title, fontSize: 46, color: c.ink, lineHeight: 50, marginBottom: 40 }}>
          Tudo pronto{'\n'}para <Text style={{ fontFamily: f.titleItalic, color: c.violet }}>você.</Text>
        </Text>

        {DEMO ? (
          <>
            <Text style={{ fontFamily: f.light, color: c.ink2, marginBottom: 16 }}>
              Versão de demonstração: dados fictícios, nada é salvo. Entre como administrador ou professor para explorar o app.
            </Text>
          </>
        ) : (
          <>
            <Field name="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field name="Senha" value={password} onChangeText={setPassword} secureTextEntry />
          </>
        )}
      </View>
      {DEMO ? (
        <>
          <Button text="Entrar como administrador" onPress={() => signInDemo('admin')} />
          <Button text="Entrar como professor" kind="line" onPress={() => signInDemo('teacher')} />
        </>
      ) : (
        <Button text={busy ? 'Entrando…' : 'Entrar'} onPress={submit} disabled={busy || !email || !password} />
      )}
      <Text onPress={() => router.push('/disponibilidade')}
        style={{ fontFamily: f.regular, color: c.violet, textAlign: 'center', marginTop: 28, letterSpacing: 0.5 }}>
        Primeiro acesso? Veja os horários e contrate seu plano
      </Text>
    </KeyboardAvoidingView>
  );
}

import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../src/lib/auth';
import { createTeacher } from '../../src/lib/data';
import { notify } from '../../src/notify';
import { c, f, label } from '../../src/theme';
import { Button, Field } from '../../src/ui';

export default function NovoProfessor() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!ready) return null;
  if (user?.role !== 'admin') return <Redirect href="/" />;

  const save = async () => {
    setBusy(true);
    try {
      await createTeacher({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password });
      notify('Professor cadastrado', 'Passe a ele o e-mail e a senha provisória. Ele já pode entrar no app.');
      router.back();
    } catch (e: any) {
      notify('Não foi possível cadastrar', e.message ?? 'Tente novamente.');
    }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} contentContainerStyle={{ padding: 24, paddingTop: 32 }}>
      <Text style={label}>Novo cadastro</Text>
      <Text style={{ fontFamily: f.title, fontSize: 38, color: c.ink, marginBottom: 32 }}>
        Novo <Text style={{ fontFamily: f.titleItalic, color: c.violet }}>professor.</Text>
      </Text>
      <Field name="Nome completo" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field name="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field name="Telefone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field name="Senha provisória (mín. 8 caracteres)" value={password} onChangeText={setPassword} />
      <View style={{ marginHorizontal: -24 }}>
        <Button text={busy ? 'Salvando…' : 'Cadastrar'} onPress={save} disabled={busy || !name || !email || password.length < 8} />
        <Button text="Cancelar" kind="line" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../src/lib/auth';
import { createStudent } from '../../src/lib/data';
import { notify } from '../../src/notify';
import { c, f, label } from '../../src/theme';
import { Button, Field } from '../../src/ui';

// Cadastro de um novo aluno (professor, ou administrador que também dá aula).
export default function NovoAluno() {
  const { user } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await createStudent(user, { name, phone, note });
      router.back();
    } catch (e: any) { notify('Não foi possível cadastrar', e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.white }} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 24, paddingTop: 32 }}>
      <Text style={label}>Novo cadastro</Text>
      <Text style={{ fontFamily: f.title, fontSize: 38, color: c.ink, marginBottom: 32 }}>
        Novo <Text style={{ fontFamily: f.titleItalic, color: c.violet }}>aluno.</Text>
      </Text>
      <Field name="Nome do aluno" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field name="Telefone (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field name="Observação (opcional)" value={note} onChangeText={setNote} autoCapitalize="sentences"
        placeholder="Instrumento, nível, objetivo…" multiline />
      <View style={{ marginHorizontal: -24 }}>
        <Button text={busy ? 'Salvando…' : 'Cadastrar aluno'} onPress={save} disabled={busy || !name.trim()} />
        <Button text="Cancelar" kind="line" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AlunosList from '../../src/AlunosList';
import Relatorio from '../../src/Relatorio';
import { c } from '../../src/theme';
import { TopTabs } from '../../src/ui';

// Duas abas no topo: a lista de alunos e o relatório semanal de aulas.
// Vale para professores e também para administradores que dão aula.
export default function AlunosTab() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState(0);
  return (
    <View style={{ flex: 1, backgroundColor: c.white, paddingTop: insets.top }}>
      <TopTabs tabs={['Alunos', 'Relatório']} active={tab} onChange={setTab} />
      {tab === 0 ? <AlunosList /> : <Relatorio />}
    </View>
  );
}

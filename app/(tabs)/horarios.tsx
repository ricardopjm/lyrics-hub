import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Agenda from '../../src/Agenda';
import Horarios from '../../src/Horarios';
import { c } from '../../src/theme';
import { TopTabs } from '../../src/ui';

// Duas abas no topo: a agenda de quem está logado e a grade para reservar horários.
export default function HorariosTab() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState(0);
  return (
    <View style={{ flex: 1, backgroundColor: c.white, paddingTop: insets.top }}>
      <TopTabs tabs={['Agenda', 'Reservar']} active={tab} onChange={setTab} />
      {tab === 0 ? <Agenda /> : <Horarios />}
    </View>
  );
}

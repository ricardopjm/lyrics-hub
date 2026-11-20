import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { c, f, label } from './theme';

export function LogoL({ size = 28, color }: { size?: number; color?: string }) {
  const fill = color ?? 'url(#g)';
  return (
    <Svg width={size * 0.887} height={size} viewBox="0 0 645 727">
      <Defs>
        <LinearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="645" y2="0">
          <Stop offset="0" stopColor="#68267F" />
          <Stop offset="1" stopColor="#653690" />
        </LinearGradient>
      </Defs>
      <Path fill={fill} d="M18 0H195A18 18 0 0 1 213 18V498A16 16 0 0 0 229 514H416A16 16 0 0 1 432 530V711A16 16 0 0 1 416 727H272C130 727 0 560 0 463V18A18 18 0 0 1 18 0Z" />
      <Rect x="432" y="295" width="213" height="219" rx="16" fill={fill} />
    </Svg>
  );
}

export function Header({ eyebrow, title, em }: { eyebrow: string; title: string; em?: string }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={label}>{eyebrow}</Text>
        <Text style={s.title}>
          {title} {em ? <Text style={s.titleEm}>{em}</Text> : null}
        </Text>
      </View>
      <LogoL size={26} />
    </View>
  );
}

// Abas no topo da tela (por exemplo: Agenda | Reservar).
export function TopTabs({ tabs, active, onChange }: { tabs: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: c.line }}>
      {tabs.map((t, i) => (
        <Pressable key={t} onPress={() => onChange(i)}
          style={{ marginRight: 24, paddingVertical: 12, marginBottom: -1, borderBottomWidth: 2,
                   borderBottomColor: i === active ? c.violet : 'transparent' }}>
          <Text style={{ fontFamily: f.regular, fontSize: 12, letterSpacing: 2, color: i === active ? c.violet : c.ink2 }}>
            {t.toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Card({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const Comp: any = onPress ? Pressable : View;
  return <Comp onPress={onPress} style={s.card}>{children}</Comp>;
}

export function Button({ text, onPress, kind = 'solid', disabled }:
  { text: string; onPress: () => void; kind?: 'solid' | 'line'; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[s.btn, kind === 'line' && s.btnLine, disabled && { opacity: 0.5 }]}>
      <Text style={[s.btnText, kind === 'line' && { color: c.violet }]}>{text}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { name: string }) {
  const { name, ...rest } = props;
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[label, { marginBottom: 6 }]}>{name}</Text>
      <TextInput placeholderTextColor={c.lilac} autoCapitalize="none" {...rest} style={s.input} />
    </View>
  );
}

export function Chip({ text, tone = 'violet' }: { text: string; tone?: 'violet' | 'ok' | 'warn' | 'bad' }) {
  const col = c[tone];
  return (
    <View style={[s.chip, { borderColor: col }]}>
      <Text style={[s.chipText, { color: col }]}>{text}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  title: { fontFamily: f.title, fontSize: 38, color: c.ink, marginTop: 4, lineHeight: 42 },
  titleEm: { fontFamily: f.titleItalic, color: c.violet },
  card: { backgroundColor: c.white, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 16, marginHorizontal: 24, marginBottom: 12 },
  btn: { backgroundColor: c.violet, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginHorizontal: 24, marginTop: 8 },
  btnLine: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.violet },
  btnText: { fontFamily: f.regular, color: c.white, fontSize: 15, letterSpacing: 0.5 },
  input: { fontFamily: f.light, fontSize: 17, color: c.ink, borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  chipText: { fontFamily: f.regular, fontSize: 11, letterSpacing: 1 },
  body: { fontFamily: f.light, fontSize: 16, color: c.ink },
  muted: { fontFamily: f.light, fontSize: 14, color: c.ink2 },
});

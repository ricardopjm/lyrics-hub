import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { OPEN_WEEKDAYS } from './config';
import { WEEKDAYS } from './lib/data';
import { c, f, label } from './theme';

// Cores dos alunos: tons da marca, do mais escuro ao mais claro.
const PALETTE = ['#672A82', '#9A62B5', '#4A1F5F', '#B48BCB', '#7C4A96', '#C9A9DA'];
export const NO_STUDENT = '#CDBCE0';

export function studentColors(names: (string | null | undefined)[]) {
  const unique = [...new Set(names.filter((n): n is string => !!n && n.trim() !== ''))].sort();
  const map = new Map<string, string>();
  unique.forEach((n, i) => map.set(n, PALETTE[i % PALETTE.length]));
  return (n?: string | null) => (n && map.get(n)) || NO_STUDENT;
}

const initials = (n?: string | null) =>
  n ? n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') : '';

// Anel de progresso com texto no centro.
export function Ring({ value, total, size = 150, stroke = 14, big, small }:
  { value: number; total: number; size?: number; stroke?: number; big: string; small: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(value / total, 1) : 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.lavender} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.violet} strokeWidth={stroke} fill="none"
            strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} />
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontFamily: f.title, fontSize: size * 0.3, color: c.ink, lineHeight: size * 0.34 }}>{big}</Text>
        <Text style={[label, { fontSize: 10 }]}>{small}</Text>
      </View>
    </View>
  );
}

// Miniatura da semana: dias em colunas, horas em linhas, cada aula é um bloco colorido pelo aluno.
export function WeekGrid({ slots, colorOf }:
  { slots: { weekday: number; start: string; student: string | null }[]; colorOf: (n?: string | null) => string }) {
  const W = 340, labelW = 34, headH = 22, rowH = 30, cols = OPEN_WEEKDAYS.length;
  const colW = (W - labelW) / cols;
  const hours = slots.map((s) => Number(s.start.slice(0, 2)));
  const minH = hours.length ? Math.min(...hours) : 9;
  const maxH = hours.length ? Math.max(...hours) : 12;
  const rows = Math.max(maxH - minH + 1, 3);
  const H = headH + rows * rowH + 4;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {OPEN_WEEKDAYS.map((d, i) => (
        <SvgText key={d} x={labelW + i * colW + colW / 2} y={14} fontSize={10} fill={c.ink2}
          textAnchor="middle" fontFamily={f.regular}>{WEEKDAYS[d].slice(0, 3).toUpperCase()}</SvgText>
      ))}
      {Array.from({ length: rows }, (_, r) => (
        <G key={r}>
          <Line x1={labelW} x2={W} y1={headH + r * rowH} y2={headH + r * rowH} stroke={c.lavender} strokeWidth={1} />
          <SvgText x={labelW - 6} y={headH + r * rowH + 16} fontSize={10} fill={c.ink2}
            textAnchor="end" fontFamily={f.light}>{`${minH + r}h`}</SvgText>
        </G>
      ))}
      {slots.map((s, i) => {
        const col = OPEN_WEEKDAYS.indexOf(s.weekday);
        if (col < 0) return null;
        const row = Number(s.start.slice(0, 2)) - minH;
        const x = labelW + col * colW + 3, y = headH + row * rowH + 3;
        return (
          <G key={i}>
            <Rect x={x} y={y} width={colW - 6} height={rowH - 6} rx={6} fill={colorOf(s.student)} />
            <SvgText x={x + (colW - 6) / 2} y={y + (rowH - 6) / 2 + 4} fontSize={10} fill={s.student ? '#fff' : c.violet}
              textAnchor="middle" fontFamily={f.regular}>{initials(s.student) || '·'}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// Barras simples: um valor por rótulo.
export function Bars({ values, labels, max }: { values: number[]; labels: string[]; max?: number }) {
  const top = Math.max(max ?? 0, ...values, 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 10 }}>
      {values.map((v, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: f.regular, fontSize: 11, color: c.ink2, marginBottom: 4 }}>{v}</Text>
          <View style={{ width: '100%', height: Math.max((v / top) * 80, 4), backgroundColor: v ? c.violet : c.lavender, borderRadius: 6 }} />
          <Text style={{ fontFamily: f.regular, fontSize: 10, color: c.ink2, marginTop: 6, letterSpacing: 1 }}>{labels[i]}</Text>
        </View>
      ))}
    </View>
  );
}

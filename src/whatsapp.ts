import { Linking, Platform } from 'react-native';
import { STUDIO } from './config';
import { brl } from './lib/data';
import { notify } from './notify';
import { DEMO } from './lib/supabase';

export type Order = {
  name: string;
  kind: 'novo' | 'renovacao' | 'cadastro';
  email?: string;            // e-mail do cadastro novo
  monthLabel?: string;       // mês da renovação, ex.: "Dezembro"
  slots: string[];           // ex.: ["Segunda 14:00", "Quarta 14:00"]
  count: number;             // horários por semana no plano
  perSlotCents: number;
  subtotalCents: number;     // valor do pedido antes do cupom
  discountCents: number;
  couponCode?: string | null;
  totalCents: number;        // valor final a pagar
};

// Texto do pedido que o professor envia para o WhatsApp da Lyrics.
export function buildOrderMessage(o: Order): string {
  const lines = [
    `Olá! Aqui é ${o.name}, da ${STUDIO.name}.`,
    o.kind === 'renovacao' ? `Estou renovando meu plano de ${o.monthLabel}.`
      : o.kind === 'cadastro' ? 'Estou me cadastrando na Lyrics Hub e fechando meu primeiro plano.' : 'Estou fechando meus horários.',
    ...(o.kind === 'cadastro' && o.email ? [`E-mail do cadastro: ${o.email}`] : []),
    '',
    `Plano: ${o.count} ${o.count === 1 ? 'horário' : 'horários'} por semana`,
    ...(o.slots.length ? [`${o.kind === 'renovacao' ? 'Horários' : 'Novos horários'}: ${o.slots.join(', ')}`] : []),
    `Valor por horário: ${brl(o.perSlotCents)}`,
    `Valor do pedido: ${brl(o.subtotalCents)}`,
    ...(o.couponCode ? [`Cupom ${o.couponCode}: − ${brl(o.discountCents)}`] : []),
    `Valor final: ${brl(o.totalCents)}`,
    '',
    o.totalCents > 0
      ? 'Pode me enviar o código Pix para o pagamento?'
      : 'O cupom cobriu o valor total, então não há nada a pagar.',
  ];
  return lines.join('\n');
}

export const whatsappUrl = (text: string) =>
  `https://wa.me/${STUDIO.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

// Abre o WhatsApp da Lyrics com a mensagem pronta.
export async function openWhatsApp(text: string) {
  if (DEMO) {
    // A demonstração não abre o WhatsApp de ninguém: mostra a mensagem que seria enviada.
    notify('Pedido (demonstração)', `Na versão real, o WhatsApp da Lyrics abre com esta mensagem pronta:\n\n${text}`);
    return;
  }
  if (!STUDIO.whatsapp.replace(/\D/g, '')) throw new Error('O WhatsApp da Lyrics ainda não foi configurado no app.');
  const url = whatsappUrl(text);
  if (Platform.OS === 'web') { window.open(url, '_blank'); return; }
  await Linking.openURL(url);
}

// Regras do negócio. Para mudar preços ou horários, mude só aqui
// (e a função price_per_slot no supabase/schema.sql, que repete a mesma regra no servidor).

// Valor mensal por horário semanal, conforme a quantidade de horários fechados.
export const TIERS = [
  { upTo: 3, cents: 15000, text: 'Até 3 horários' },
  { upTo: 6, cents: 12000, text: 'De 4 a 6 horários' },
  { upTo: Infinity, cents: 10000, text: 'Acima de 6 horários' },
];

export const pricePerSlot = (count: number) =>
  count <= 0 ? 0 : TIERS.find((t) => count <= t.upTo)!.cents;

export const totalCents = (count: number) => count * pricePerSlot(count);

// Grade de horários, em blocos de 1 hora.
// Segunda a sexta: 9h às 22h. Sábado: 9h às 18h. Domingo fechado.
export const OPEN_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => hh(from + i));

export const hoursFor = (weekday: number) => (weekday === 6 ? range(9, 18) : range(9, 22));
export const endOf = (start: string) => hh(Number(start.slice(0, 2)) + 1);

// Dados do estúdio (tela Conta).
export const STUDIO = {
  name: 'Lyrics Hub',
  by: 'by Casa 90 Music Center',
  address: 'Avenida Cassiopeia, 118',
  hours: [
    { days: 'Segunda a sexta', time: '9h às 22h' },
    { days: 'Sábado', time: '9h às 18h' },
  ],
  // WhatsApp que recebe os pedidos (só números, com 55 e DDD). Definido em EXPO_PUBLIC_WHATSAPP no arquivo .env.
  whatsapp: process.env.EXPO_PUBLIC_WHATSAPP ?? '',
  instagram: '@lyrics.hub',
  instagramUrl: 'https://instagram.com/lyrics.hub',
};

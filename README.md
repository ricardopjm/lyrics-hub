# Lyrics Hub

Aplicativo de gestão para um **coworking mensal de salas de música**: professores alugam horários fixos
na sala, os administradores controlam agenda, pagamentos e cadastros, e tudo roda no celular
(app web instalável hoje, pronto para iPhone e Android).

Nasceu de uma necessidade real: abrir um estúdio com aluguel mensal de salas e controlar horários, cobranças
e acesso de cada professor sem depender de planilhas nem de um sistema de desktop.

> **English summary** — Mobile-first management app for a monthly music-room coworking space, built with
> Expo / React Native (TypeScript) and Supabase (Postgres + Row Level Security + Edge Functions + pg_cron).
> Three roles (visitor, teacher, admin), server-side pricing with tiered discounts and coupons, a manual
> payment-confirmation queue driven by WhatsApp + Pix, and an installable PWA deployed on Netlify.

<!-- Adicione capturas de tela em docs/screenshots/ e referencie aqui:
![Início do professor](docs/screenshots/inicio-professor.png)
-->

## O que o app faz

**Visitante (sem login)**
- Vê a grade pública de horários livres e ocupados (sem expor nomes de ninguém) e simula o valor do plano.
- Cria a própria conta ao contratar o primeiro plano, com campo de cupom. A conta nasce **inativa** e só é
  liberada quando o administrador confirma o pagamento.

**Professor**
- Início com resumo visual: anel de aulas do mês, alunos, plano e a semana colorida por aluno.
- Reserva horários, renova o plano com cupom e envia o pedido ao administrador por WhatsApp.
- Cadastra alunos, mantém o histórico de cada um e acompanha um relatório semanal (aula dada, falta, sem registro).
- Se o plano vence, os horários são liberados, mas a conta, os alunos e todo o histórico continuam; ele contrata de novo pelo app.

**Administrador**
- Painel de ocupação da sala, professores, alunos e financeiro do mês.
- **Fila de pedidos**: confere o Pix e confirma (a cobrança vira "Recebido" e o cadastro é ativado) ou recusa
  (horários liberados e cupom devolvido).
- Cadastra e desliga professores, reserva horários em nome de um professor (com valor manual) e também para si.
- Cria cupons de desconto (porcentagem ou valor fixo, com validade e limite de usos).

## Regras de negócio

| Item | Regra |
|---|---|
| Preço | Valor mensal por horário semanal, pela quantidade total: até 3 = R$ 150 · de 4 a 6 = R$ 120 · acima de 6 = R$ 100 (a faixa vale para todos os horários) |
| Funcionamento | Segunda a sexta 9h–22h, sábado 9h–18h, blocos de 1 hora |
| Cupom | Opcional, na contratação e na renovação; uma vez por professor; porcentagem ou valor fixo |
| Pagamento | Pix combinado por WhatsApp; o administrador confirma manualmente |
| Plano | Vale até o último dia do mês pago; ao vencer, libera os horários e mantém a conta |

## Decisões técnicas que valem destacar

- **Segurança no banco, não só na tela.** Todas as tabelas usam *Row Level Security*; o professor só lê o que é dele.
  Funções `SECURITY DEFINER` expõem só o necessário (por exemplo, a grade pública devolve apenas livre/ocupado).
- **Preço e desconto calculados no servidor.** O app mostra o valor, mas quem decide é o Postgres. Um professor
  não consegue enviar um preço próprio (isso foi testado e corrigido durante o desenvolvimento).
- **Cadastro público seguro.** Uma Edge Function (Deno) com a chave de serviço cria a conta inativa, reserva os
  horários e desfaz tudo se algo falhar. Cadastros não pagos expiram sozinhos em 3 dias.
- **Rotinas no próprio banco** com `pg_cron`: vencimento de planos, cancelamento de cadastros esquecidos e
  lembrete de aula (via `pg_net`).
- **Um código para web e celular**, com `expo-router`. A versão web é um PWA instalável (manifesto, ícones, tela cheia).
- **Gráficos próprios** (anel de progresso e grade semanal em SVG, barras em componentes nativos), sem biblioteca de gráficos.

## Stack

Expo SDK 58 · React Native · React 19 · TypeScript · expo-router · react-native-svg ·
Supabase (Postgres, Auth, RLS, PL/pgSQL, Edge Functions, pg_cron, pg_net) · Netlify (hospedagem do PWA)

## Estrutura

```
app/         telas (expo-router): login, cadastro, abas, fichas, cupons
src/         componentes, gráficos, regras de preço (config.ts), camada de dados (lib/data.ts)
supabase/    SQL do banco e Edge Functions (invite-teacher, signup-teacher)
public/      manifesto e ícones do PWA
```

## Como rodar

Pré-requisitos: Node.js (versão LTS atual) e um projeto no [Supabase](https://supabase.com).

```bash
npm install
cp .env.example .env      # preencha a URL e a chave publishable do Supabase e o WhatsApp
npm run web               # abre no navegador (ou: npx expo start, e leia o QR code com o Expo Go)
```

### Banco de dados

No **SQL Editor** do Supabase, rode os arquivos de `supabase/` nesta ordem (é a ordem em que o projeto foi aplicado;
uma instalação do zero ainda não foi automatizada):

1. `schema.sql` — tabelas, regras de acesso (RLS), preços e grade pública
2. `notificacoes.sql` — registro de aparelhos e lembrete de aula
3. `admin-reservas.sql` — reservas feitas por administradores
4. `inicio.sql` — painéis e renovação do plano
5. `cupons.sql` — cupons de desconto
6. `alunos.sql` — alunos, histórico e relatório semanal
7. `pendentes.sql` — lembrete único + fila de pedidos aguardando confirmação
8. `cadastro.sql` — cadastro público e vencimento do plano

Depois: crie os administradores em *Authentication → Users* e rode `admins.sql` (com os e-mails reais).
Se aparecer `permission denied`, rode `liberar-acesso.sql`. Para um estúdio de uma sala só, veja `uma-sala.sql`.

### Edge Functions

Publique `supabase/functions/invite-teacher` e `supabase/functions/signup-teacher`.
A `signup-teacher` é pública: desligue **Verify JWT** ao publicar.

### Publicar a versão web

```bash
npx expo export --platform web   # gera a pasta dist/
```

Envie a pasta `dist/` para qualquer hospedagem estática (Netlify, Vercel, Cloudflare Pages).
O arquivo `public/_redirects` já cobre o recarregamento de páginas internas.

## Versão de demonstração

Sem as variáveis do Supabase, o app roda em **modo demonstração**: dados fictícios em memória, nenhum servidor e
nada é salvo (recarregar a página reinicia tudo). Dá para percorrer o fluxo completo: escolher horários como visitante,
criar uma conta (o pedido aparece na fila do administrador), confirmar o pagamento, renovar plano, usar cupons
(código `PROMO10`) e cadastrar alunos. O WhatsApp não abre: a mensagem do pedido é exibida na tela.

```bash
npm run build:demo     # gera a pasta dist-demo/ sem nenhuma conexão com banco
```

<!-- Link da demonstração publicada: https://SEU-SITE-DEMO.netlify.app -->

## Limitações conhecidas

- **Sem suíte de testes automatizados.** O fluxo foi validado manualmente, de ponta a ponta, contra um Supabase real.
- **Notificações push** estão implementadas, mas só funcionam com o app nativo instalado pelas lojas (precisa de
  conta de desenvolvedor Apple/Google). Na versão web não há push.
- **Pagamento manual**: não há gateway; o Pix é combinado por WhatsApp e confirmado pelo administrador.
- Uma sala, interface em português do Brasil.

## Licença e marca

O código está sob a licença [MIT](LICENSE).

O nome, o logotipo e a identidade visual da Lyrics / Casa 90 Music Center pertencem ao negócio e **não** estão
cobertos por essa licença: não podem ser reutilizados como marca.

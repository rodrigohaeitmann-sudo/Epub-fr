# Revisão EN·FR — revisão espaçada da sua planilha

Webapp (React + Vite, PWA) com o tema "Claro & essencial" (Instrument Sans, azul
contido) e variante noturna — tokens e regras em `design/` do export do Claude
Design; alternância de tema em Ajustes (persistida em `revfr-theme`).

Webapp para revisar palavras e expressões em inglês e
francês salvas em uma planilha Google. Você vê e ouve a expressão, tenta
lembrar o significado, revela a resposta (tradução, dica de pronúncia e
exemplos de uso) e decide quando ela deve voltar:

- **Difícil** — volta amanhã (e reaparece uma vez no fim da sessão);
- **Médio** — lembrou com esforço: sobe uma caixa (1 → 3 → 7 → 16 → 35 → 70 → 140 dias);
- **Fácil** — sobe duas caixas.

A resposta vem pelos botões, pelo teclado (`1`/`2`/`3`) ou **deslizando o card**:
**← fácil**, **↓ médio**, **→ difícil**. Enquanto você arrasta, o card acompanha
o dedo e um selo mostra qual resposta será registrada — soltar antes do meio do
caminho cancela. O gesto só vale com o verso à mostra (não dá para avaliar o
que você ainda não viu) e nunca atrapalha a rolagem da página: arrastar para
baixo só avalia quando não há o que rolar de volta.

O progresso é gravado por um Google Apps Script na aba `Progresso` da própria
planilha — a aba de palavras continua dinâmica e nunca é alterada.

**Funciona offline** (ex.: durante um voo): um service worker mantém o app
instalável e abrível sem internet, os cards ficam copiados no aparelho e cada
resposta entra numa fila local, sincronizada automaticamente quando a conexão
volta (evento `online` + retentativa periódica).

## Como configurar

1. **Backend**: siga [apps-script/README.md](apps-script/README.md) para
   instalar o script na planilha e obter a URL `/exec`.
2. **App**: rode local (`npm install && npm run dev`) ou use a versão publicada
   no GitHub Pages (workflow em `.github/workflows/deploy.yml`).
3. Abra o app, clique em ⚙️ e cole a URL do Apps Script.

## Recursos

- **Menu inicial com três modos de estudo** (blocos de 10 cards):
  - ✨ *Estudo sugerido* — 5 revisões (na ordem de prioridade) + 5 novas em
    ordem aleatória; completa de um lado se faltar do outro;
  - 🔁 *Revisão* — 10 cards já vistos, priorizando os difíceis e os mais
    próximos da hora de revisar;
  - 🌱 *Novas* — 10 cards ainda não respondidos, em ordem aleatória.
- Tela de estudo com progresso do bloco (`Revisão · 4/10`) e botão ← Menu;
  ao concluir, o bloco é salvo e o resumo aparece na hora, com "Mais um bloco".
- Verso rico: tradução em destaque, **dica de pronúncia** (Comentário IPA) e
  **exemplos de uso**, cada um com a expressão destacada, tradução em português
  e botão de áudio próprio.
- **✨ Mais exemplos**: a planilha pode ter quantos exemplos você quiser (o
  modelo atual tem 9 por palavra) e o card abre com **3 sorteados** — então
  cada novo contato com a palavra já começa diferente. O botão então revela,
  em ordem: **os outros da planilha**, depois o que houver no **seu próprio
  acervo** (outros cards e a planilha de frases que usam a palavra, o que
  **funciona offline**) e, por fim, frases geradas na hora pelo Apps Script
  (requer `GEMINI_API_KEY`, veja [apps-script/README.md](apps-script/README.md)).
- Áudio via Web Speech API: pronúncia da expressão, da frase original e de
  cada exemplo, com voz em inglês ou francês definida pela coluna `Língua`.
- Filtro por idioma, IPA quando disponível, e "capturado de…" mostrando a
  frase original quando difere da expressão.
- **Frases por tema**: uma segunda planilha (independente, com
  `apps-script/Frases.gs`) alimenta blocos de 10 frases — cada aba é um tema,
  escolhido por chips no menu; francês na frente (falado automaticamente),
  tradução no verso, mesma avaliação e agendamento das palavras, com progresso
  gravado na aba `Progresso` da planilha de frases. Três modos, como nas
  palavras: *sugeridas* (5 revisões + 5 novas), *revisar* (10 já vistas) e
  *novas* (10 inéditas).
- **Consulta de trecho**: tocar numa palavra/frase mostra a tradução e a
  pronúncia em IPA — do card quando a palavra está na planilha, senão tradução
  automática e IPA aproximado gerado por regras (`src/ipa.ts`). A tradução
  tenta o Apps Script e, se ele ainda não foi republicado (ou falhar), um
  tradutor público; o resultado fica em cache para repetir offline. Quando
  nada funciona, o app diz **por quê** (sem internet / republique o script /
  não encontrada) em vez de um aviso genérico.
- **Minhas coleções**: salve qualquer palavra ou frase (botão ☆, no verso do
  card ou na ficha) em coleções suas — "Trabalho", "Viagem", o que fizer
  sentido. Cada coleção tem sua **própria tela**, com:
  - a **lista completa** do que está salvo (idioma, caixa, quantas vezes você
    revisou), com áudio e ✕ para tirar da coleção, e toque para abrir a ficha;
  - **quantos cards** entram no bloco — 5, 10, 20… ou **todas**, sem o limite
    fixo de 10;
  - **a ordem**: 🔀 embaralhar (sorteia a cada bloco, para não cair sempre nas
    mesmas), 🌱 menos vistas primeiro ou ⏱ prioridade de revisão.

  A revisão é livre, **a qualquer momento**, sem esperar o agendamento, e
  mistura palavras e frases. As coleções ficam no aparelho (funcionam offline)
  e as respostas continuam indo para a planilha certa.
- **Voz, sotaque e velocidade** (em Ajustes): escolha a voz de cada idioma
  entre as instaladas no aparelho — cada uma é um sotaque (França, Canadá,
  EUA, Reino Unido…) — com botão de teste, e ajuste a velocidade da fala no
  slider ou nos atalhos (🐢 bem devagar → 🐇 bem rápido). Vale para toda fala
  do app, inclusive a automática ao abrir o card, e fica salva no aparelho.
- **Blocos já feitos**: o menu inicial lista o histórico de blocos (modo, data
  e nº de cards); cada bloco expande para mostrar o resultado por expressão
  (difícil/padrão/fácil), e cada expressão reabre a ficha completa.
- **Busca** (🔍): encontra por expressão, tradução ou exemplo, mesmo offline;
  abre a ficha completa da palavra, com opção "Praticar agora".
- **Toque em qualquer palavra dos exemplos** (ou selecione um trecho) para
  ouvi-la isolada e consultá-la na sua lista: se já for um card, o painel
  mostra a tradução com atalho "ver card"; senão, mostra onde ela aparece e
  oferece a busca completa.
- **Avaliar deslizando**: com o verso à mostra, arraste o card — **←** fácil,
  **↓** médio, **→** difícil — com selo de confirmação e o card saindo para o
  lado escolhido. Os botões e o teclado continuam valendo.
- Atalhos de teclado: `espaço` revela, `P` ouve, `1`/`2`/`3` respondem,
  `Esc` fecha busca/ficha.

## Estrutura

- `src/` — o webapp.
- `apps-script/` — backend que roda dentro da planilha (fonte de dados + gravação do progresso).

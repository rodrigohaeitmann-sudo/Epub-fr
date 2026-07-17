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
  até 3 **exemplos de uso**, cada um com a expressão destacada, tradução em
  português e botão de áudio próprio.
- Áudio via Web Speech API: pronúncia da expressão, da frase original e de
  cada exemplo, com voz em inglês ou francês definida pela coluna `Língua`.
- Filtro por idioma, IPA quando disponível, e "capturado de…" mostrando a
  frase original quando difere da expressão.
- **Blocos já feitos**: o menu inicial lista o histórico de blocos (modo, data
  e nº de cards); cada bloco expande para mostrar o resultado por expressão
  (difícil/padrão/fácil), e cada expressão reabre a ficha completa.
- **Busca** (🔍): encontra por expressão, tradução ou exemplo, mesmo offline;
  abre a ficha completa da palavra, com opção "Praticar agora".
- **Toque em qualquer palavra dos exemplos** (ou selecione um trecho) para
  ouvi-la isolada e consultá-la na sua lista: se já for um card, o painel
  mostra a tradução com atalho "ver card"; senão, mostra onde ela aparece e
  oferece a busca completa.
- Atalhos de teclado: `espaço` revela, `P` ouve, `1`/`2`/`3` respondem,
  `Esc` fecha busca/ficha.

## Estrutura

- `src/` — o webapp.
- `apps-script/` — backend que roda dentro da planilha (fonte de dados + gravação do progresso).

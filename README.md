# Revisão EN·FR — revisão espaçada da sua planilha

Webapp (React + Vite, PWA) para revisar palavras e expressões em inglês e
francês salvas em uma planilha Google. Você vê e ouve a expressão, tenta
lembrar o significado, revela a resposta (tradução, dica de pronúncia e
exemplos de uso) e decide quando ela deve voltar:

- **Pouco tempo** — ainda difícil: volta amanhã (e reaparece no fim da sessão);
- **Tempo padrão** — lembrou com esforço: sobe uma caixa (1 → 3 → 7 → 16 → 35 → 70 → 140 dias);
- **Muito tempo** — fácil: sobe duas caixas.

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

- Fila do dia: cards vencidos primeiro (mais atrasados antes) + até 20 novos
  por sessão (botão para puxar mais 20 ao terminar).
- Verso rico: tradução em destaque, **dica de pronúncia** (Comentário IPA) e
  até 3 **exemplos de uso**, cada um com a expressão destacada, tradução em
  português e botão de áudio próprio.
- Áudio via Web Speech API: pronúncia da expressão, da frase original e de
  cada exemplo, com voz em inglês ou francês definida pela coluna `Língua`.
- Filtro por idioma, IPA quando disponível, e "capturado de…" mostrando a
  frase original quando difere da expressão.
- **Resumo de sessão**: ao terminar a fila, o app salva a sessão no aparelho e
  mostra um card com o resultado de cada expressão (difícil/padrão/fácil);
  toque numa delas para revê-la. As sessões anteriores ficam num histórico.
- **Busca** (🔍): encontra por expressão, tradução ou exemplo, mesmo offline;
  abre a ficha completa da palavra, com opção "Praticar agora".
- Atalhos de teclado: `espaço` revela, `P` ouve, `1`/`2`/`3` respondem,
  `Esc` fecha busca/ficha.

## Estrutura

- `src/` — o webapp.
- `apps-script/` — backend que roda dentro da planilha (fonte de dados + gravação do progresso).

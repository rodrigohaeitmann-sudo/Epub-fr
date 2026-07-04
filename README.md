# Revisão EN·FR — revisão espaçada da sua planilha

Webapp (React + Vite, PWA) para revisar palavras e expressões em inglês e
francês salvas em uma planilha Google. Você vê e ouve a expressão, tenta
lembrar o significado, revela a resposta (tradução + contexto de origem) e
decide quando ela deve voltar:

- **Pouco tempo** — ainda difícil: volta amanhã (e reaparece no fim da sessão);
- **Tempo padrão** — lembrou com esforço: sobe uma caixa (1 → 3 → 7 → 16 → 35 → 70 → 140 dias);
- **Muito tempo** — fácil: sobe duas caixas.

O progresso é gravado por um Google Apps Script na aba `Progresso` da própria
planilha — a aba de palavras continua dinâmica e nunca é alterada. Se a rede
falhar, as respostas ficam numa fila local e são sincronizadas depois.

## Como configurar

1. **Backend**: siga [apps-script/README.md](apps-script/README.md) para
   instalar o script na planilha e obter a URL `/exec`.
2. **App**: rode local (`npm install && npm run dev`) ou use a versão publicada
   no GitHub Pages (workflow em `.github/workflows/deploy.yml`).
3. Abra o app, clique em ⚙️ e cole a URL do Apps Script.

## Recursos

- Fila do dia: cards vencidos primeiro (mais atrasados antes) + até 20 novos
  por sessão (botão para puxar mais 20 ao terminar).
- Áudio via Web Speech API: pronúncia da expressão e da frase de contexto,
  com voz em inglês ou francês detectada automaticamente (coluna `Idioma`
  tem prioridade, se existir).
- Filtro por idioma, IPA quando disponível, contexto com a expressão destacada.
- Atalhos de teclado: `espaço` revela, `1`/`2`/`3` respondem.

## Estrutura

- `src/` — o webapp.
- `apps-script/` — backend que roda dentro da planilha (fonte de dados + gravação do progresso).

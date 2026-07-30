# Backends nas planilhas (Google Apps Script)

Este diretório tem **dois scripts independentes**:

| Script | Planilha | Uso no app |
| --- | --- | --- |
| [`Code.gs`](Code.gs) | vocabulário (palavras/expressões) | campo "URL — Palavras" em Ajustes |
| [`Frases.gs`](Frases.gs) | frases por tema (planilha separada) | campo "URL — Frases" em Ajustes |

No script de **frases**, cada aba da planilha é um tema (o nome da aba aparece
como filtro no app); as abas "Progresso" e as que contenham "guia"/"pronúncia"
no nome são ignoradas. Cada aba tem uma frase por linha: coluna do francês e
coluna da tradução (achadas pelo cabeçalho — ex.: `Frase`/`Francês` e
`Tradução`/`Português`, com `Dica`/`Pronúncia` opcional — ou, sem cabeçalho,
A = francês e B = tradução). A instalação é idêntica à do script de palavras
(abaixo), só que na planilha de frases e colando `Frases.gs`.

# Backend de palavras (Code.gs)

O app lê as palavras/expressões da **primeira aba** da sua planilha e grava o
progresso da revisão na aba **`Progresso`** (criada automaticamente). A aba de
palavras **nunca é modificada** pelo script.

## Colunas reconhecidas na aba de palavras

A ordem não importa; o script casa pelos nomes (com ou sem acento). Modelo atual:

| Coluna | Uso no app |
| --- | --- |
| `Expressão` | frente do card — o que você estuda (obrigatória) |
| `Texto original` | frase de onde a expressão foi capturada (mostrada como "capturado de…") |
| `Língua` | `Inglês` / `Francês` — define a voz do áudio e o filtro |
| `Tipo` | badge `palavra` / `expressão` |
| `IPA` | pronúncia exibida sob a expressão |
| `Comentário IPA` | dica de pronúncia (destacada no verso) |
| `Tradução` | tradução principal (verso) |
| `Exemplo 1..N` + `Tradução 1..N` | exemplos de uso, cada um com áudio próprio e tradução — quantos você quiser (o modelo atual usa 9); o app abre com 3 sorteados |
| `ID` | chave do progresso (ver abaixo) |

O modelo antigo (`Texto`, `Traduções`, `Contexto`, `Fonte`, `Capítulo`) continua
sendo lido, para não quebrar planilhas anteriores.

## Sobre a coluna ID

O `ID` é a chave que liga cada palavra ao seu progresso na aba `Progresso`.
Se estiver vazio, o app deriva uma chave estável de `Língua + Expressão`, então
tudo funciona **sem preencher nada**. Mas recomendo preencher o ID (números
simples servem) antes de começar a salvar palavras repetidas, para garantir que
o progresso nunca se confunda. Para preencher de uma vez:

> Menu **Revisão → Preencher IDs faltantes** (criado por este script; numera só as
> linhas vazias, sem tocar nas que já têm ID). Recarregue a página após rodar.

## Instalação (uma vez só)

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague o conteúdo de `Código.gs` e cole o arquivo [`Code.gs`](Code.gs) deste diretório.
3. **Implantar → Nova implantação → App da Web**:
   - *Executar como*: **você**;
   - *Quem pode acessar*: **Qualquer pessoa com o link**.
4. Autorize o script e copie a URL terminada em **`/exec`**.
5. No app, abra ⚙️ e cole essa URL.

> Teste rápido: abra `SUA_URL/exec?action=ping` no navegador — deve responder `{"ok":true,...}`.

## Atualizações do script

Se este arquivo mudar no repositório, cole o novo conteúdo no editor do Apps
Script e use **Implantar → Gerenciar implantações → ✏️ → Nova versão** (assim a
URL `/exec` continua a mesma).

## API

- `GET ?action=cards` → `{ ok, today, cards: [...] }` — cada card traz
  `id, text, original, language, type, ipa, ipaComment, translation,
  examples: [{ text, translation }], box, repetitions, nextReview, ...`.
- `GET ?action=ping` → `{ ok: true, version }`.
- `GET ?action=translate&from=fr&to=pt&q=...` → `{ ok, translation }` — usado
  quando você toca numa palavra solta que não está na planilha.
- `GET ?action=examples&lang=fr&q=...&avoid=...` → `{ ok, examples: [...] }` —
  frases novas geradas pelo botão "✨ Mais exemplos" (ver abaixo).
- `POST` (Content-Type `text/plain`, corpo JSON):
  - `{ "action": "review", "id": "...", "text": "...", "result": "short" | "standard" | "long" }`
  - `{ "action": "reviewBatch", "reviews": [ ... ] }` — usado pela fila offline do app.

Agendamento (Leitner): intervalos por caixa `[1, 3, 7, 16, 35, 70, 140]` dias.
`standard` sobe 1 caixa, `long` sobe 2, `short` desce 1 e volta amanhã.

## Exemplos gerados por IA (opcional)

No verso de cada card há o botão **✨ Mais exemplos**. Ele funciona em três
etapas:

1. **Da própria planilha** — o card abre com 3 exemplos sorteados entre os que
   a linha tem (9, no modelo atual); o primeiro toque revela os outros.
2. **Do seu próprio acervo** — procura a palavra nos exemplos dos outros cards
   e nas frases da planilha de frases. Isso roda no aparelho e **funciona
   offline**, sem configurar nada.
3. **Geradas na hora** — quando a planilha e o acervo acabam, o app chama
   `?action=examples` neste script, que pede frases novas ao Gemini.

A etapa 3 só liga se você guardar uma chave:

1. Pegue uma chave em <https://aistudio.google.com/apikey>.
2. No editor do Apps Script: **⚙️ Configurações do projeto → Propriedades do
   script → Adicionar propriedade** — nome `GEMINI_API_KEY`, valor a chave.
3. Reimplante (**Gerenciar implantações → ✏️ → Nova versão**).

Sem a chave, o app avisa "configure GEMINI_API_KEY no Apps Script para gerar
frases" e segue usando só os exemplos da planilha e do acervo.

# Backend na planilha (Google Apps Script)

O app lê as palavras/expressões da **primeira aba** da sua planilha e grava o
progresso da revisão na aba **`Progresso`** (criada automaticamente). A aba de
palavras **nunca é modificada** pelo script.

## Colunas reconhecidas na aba de palavras

A ordem não importa; o script casa pelos nomes (com ou sem acento):

| Coluna | Uso no app |
| --- | --- |
| `Texto` | frente do card (obrigatória) |
| `Tipo` | badge `word` / `expression` |
| `IPA` | pronúncia exibida sob o texto |
| `Traduções` | verso do card |
| `Contexto` | frase/parágrafo de origem (com a expressão destacada) |
| `Capítulo`, `Fonte` | referência exibida no verso |
| `ID` | chave do progresso (se vazio, usa o próprio texto) |
| `Idioma` *(opcional)* | `en` ou `fr` — sem ela o app detecta automaticamente |

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

- `GET ?action=cards` → `{ ok, today, cards: [...] }` — todos os cards com progresso mesclado.
- `GET ?action=ping` → `{ ok: true }`.
- `POST` (Content-Type `text/plain`, corpo JSON):
  - `{ "action": "review", "id": "...", "text": "...", "result": "short" | "standard" | "long" }`
  - `{ "action": "reviewBatch", "reviews": [ ... ] }` — usado pela fila offline do app.

Agendamento (Leitner): intervalos por caixa `[1, 3, 7, 16, 35, 70, 140]` dias.
`standard` sobe 1 caixa, `long` sobe 2, `short` desce 1 e volta amanhã.

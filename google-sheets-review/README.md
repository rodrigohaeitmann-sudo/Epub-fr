# Banco de revisão no Google Sheets

Este diretório contém o backend em Google Apps Script para transformar a planilha em um banco de dados de revisão espaçada.

## Regra importante de segurança

A aba `palavras` é a fonte das expressões e pode conter `IMPORTRANGE`. O script **não deve limpar, recriar, renomear nem substituir o cabeçalho dessa aba**. Ele apenas lê os dados existentes e grava o progresso em outra aba.

Se a aba `palavras` foi sobrescrita por uma versão anterior do script, restaure-a pelo histórico da planilha: **Arquivo → Histórico de versões → Ver histórico de versões**.

## Abas usadas

| Aba | Finalidade | O script altera? |
| --- | --- | --- |
| `palavras` | Guarda as palavras/expressões que você já importa de outra planilha. | Não. Somente leitura. |
| `Progresso` | Guarda caixa, repetições, lapsos, última resposta e próxima revisão. | Sim. Criada/atualizada pelo script. |

## Colunas aceitas na aba `palavras`

O script aceita a estrutura atual da sua planilha, por exemplo:

- `Texto`: palavra/expressão principal.
- `Tipo`: word, expression, Listening etc.
- `IPA`: pronúncia fonética, quando existir.
- `Traduções`: tradução/anotação em português.
- `Contexto`: frase ou trecho de exemplo.
- `Capítulo`: livro, capítulo ou agrupamento.
- `Fonte`: fonte da expressão.
- `Salva em (app)`: timestamp de origem.
- `Recebida em`: data recebida.
- `ID`: identificador único.

Também são aceitos nomes equivalentes como `expression`, `translation`, `context`, `id` e `language`.

## Colunas da aba `Progresso`

- `expressionId`: id da expressão revisada.
- `box`: caixa atual do algoritmo Leitner.
- `repetitions`: total de revisões.
- `lapses`: total de erros.
- `lastResult`: `again`, `hard`, `good` ou `easy`.
- `lastReviewedAt`: última data de revisão.
- `nextReview`: próxima data em que o card deve aparecer.
- `updatedAt`: timestamp ISO da última atualização.

## Como implantar

1. Abra sua planilha no Google Sheets.
2. Acesse **Extensões → Apps Script**.
3. Cole o conteúdo de `google-sheets-review/Code.gs` no editor.
4. Salve o projeto.
5. Execute a função `ensureSchema_` uma vez. Ela valida se `palavras` existe e cria apenas a aba `Progresso` se necessário.
6. Publique em **Implantar → Nova implantação → App da Web**.
7. Configure o acesso conforme sua necessidade e copie a URL terminada em `/exec`.

## Endpoints

- `GET <URL>/exec?action=due&language=all`: retorna cards vencidos para revisão.
- `GET <URL>/exec?action=all`: retorna todos os cards com progresso mesclado.
- `GET <URL>/exec?action=progress`: retorna todo o progresso salvo na aba `Progresso`.
- `GET <URL>/exec?action=progress&expressionId=abc-123`: consulta o progresso de uma expressão específica.
- `GET <URL>/exec?action=stats`: retorna estatísticas gerais: total, vencidos, revisados, lapsos e idiomas.
- `GET <URL>/exec?action=schema`: retorna a estrutura esperada/aceita das abas.
- `POST <URL>/exec` com `{ "action": "review", "expressionId": "...", "result": "good" }`: salva uma revisão.
- `POST <URL>/exec` com `{ "action": "upsertExpression", "expression": { ... } }`: insere ou atualiza uma expressão respeitando os cabeçalhos existentes.

## Exemplo de payload para salvar revisão

```json
{
  "action": "review",
  "expressionId": "abc-123",
  "result": "good"
}
```

O script recalcula a caixa e grava a próxima data de revisão na aba `Progresso`.

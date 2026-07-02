# Banco de revisão no Google Sheets

Este diretório contém o backend em Google Apps Script para transformar a planilha em um banco de dados de revisão espaçada.

## Abas criadas

O script `Code.gs` cria e mantém duas abas:

| Aba | Finalidade |
| --- | --- |
| `Expressoes` | Guarda as palavras/expressões que você quer estudar. |
| `Progresso` | Guarda o histórico de revisão por expressão: caixa, repetições, lapsos, última resposta e próxima data de revisão. |

## Colunas esperadas

### `Expressoes`

- `id`: identificador único da expressão. Pode ser preenchido manualmente ou pelo script.
- `expression`: expressão em inglês/francês.
- `language`: `en-US`, `fr-FR`, `en` ou `fr`.
- `translation`: tradução/anotação em português.
- `context`: frase de exemplo.
- `tags`: tema, fonte ou categoria.
- `createdAt`: data de criação no formato `yyyy-MM-dd`.

### `Progresso`

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
3. Cole o conteúdo de `google-apps-script/Code.gs` no editor.
4. Salve o projeto.
5. Execute a função `ensureSchema_` uma vez para criar/validar as abas.
6. Publique em **Implantar → Nova implantação → App da Web**.
7. Configure o acesso conforme sua necessidade e copie a URL terminada em `/exec`.

## Endpoints

- `GET <URL>/exec?action=due&language=all`: retorna cards vencidos para revisão.
- `GET <URL>/exec?action=all`: retorna todos os cards com progresso mesclado.
- `GET <URL>/exec?action=progress`: retorna todo o progresso salvo na aba `Progresso`.
- `GET <URL>/exec?action=progress&expressionId=abc-123`: consulta o progresso de uma expressão específica.
- `GET <URL>/exec?action=stats`: retorna estatísticas gerais: total, vencidos, revisados, lapsos e idiomas.
- `GET <URL>/exec?action=schema`: retorna a estrutura esperada das abas.
- `POST <URL>/exec` com `{ "action": "review", "expressionId": "...", "result": "good" }`: salva uma revisão.
- `POST <URL>/exec` com `{ "action": "upsertExpression", "expression": { ... } }`: insere ou atualiza uma expressão.

## Exemplo de payload para salvar revisão

```json
{
  "action": "review",
  "expressionId": "abc-123",
  "result": "good"
}
```

O script recalcula a caixa e grava a próxima data de revisão na aba `Progresso`.

## Consultar progresso

Para consultar todo o progresso salvo:

```text
GET <URL>/exec?action=progress
```

Para consultar apenas uma expressão:

```text
GET <URL>/exec?action=progress&expressionId=abc-123
```

Para um resumo geral do estudo:

```text
GET <URL>/exec?action=stats
```

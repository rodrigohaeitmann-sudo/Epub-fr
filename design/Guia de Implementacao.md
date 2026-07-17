# Revisão EN·FR — Guia de Implementação

Tema final baseado na direção "Claro & essencial" (Instrument Sans, azul contido), com variante noturna. Referência viva: `Revisão EN-FR Final.dc.html`.

## Fonte
- **Instrument Sans** (Google Fonts), pesos 400 / 500 / 600 / 700
- `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap`
- Fallback: `sans-serif`

## Tokens de cor

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| bg | `#f5f6f7` | `#101317` | fundo da página |
| surface | `#ffffff` | `#171c22` | cards e painéis |
| border | `#e3e6e8` | `#272f38` | bordas 1px |
| text | `#16191c` | `#e8ecef` | texto principal |
| sub | `#6b7480` | `#8a94a0` | texto secundário |
| faint | `#a0a8b0` | `#5b6570` | dicas e rodapés |
| track | `#edf0f2` | `#1e2530` | trilhas de barra, chips neutros |
| accent | `#2f5fd0` | `#5b8def` | botão primário, progresso |
| accentText | `#ffffff` | `#0b1220` | texto sobre accent |
| accentStrong | `#2f5fd0` | `#7ba4f5` | significado no verso do card |
| accentSoft | `#e9eefb` | `#18233a` | chip de idioma, ícone de sucesso |
| accentSoft2 | `#cdd9f2` | `#2b3d5e` | borda esquerda dos exemplos |
| hard | `#c04a3a` | `#e0705b` | avaliação "difícil" |
| easy | `#2f7d54` | `#4fb37e` | avaliação "fácil" |

Preferência de tema persiste em `localStorage` (chave `revfr-theme`).

## Escala tipográfica
- Título do hub: 23px / 700 / letter-spacing -0.01em
- Número grande ("hoje"): 46px / 700
- Palavra no card: 42px / 700 / letter-spacing -0.02em
- IPA: 17px / 400 / cor `sub`
- Significado (verso): 21px / 700 / cor `accentStrong`
- Corpo: 13–15px; labels de seção: 12px / 700 / uppercase / letter-spacing .08–.1em
- Botão primário: 15–16px / 700

## Forma e espaçamento
- Raio: cards 16–20px; botões 10–14px; pills/chips 99px
- Padding de tela: 20–28px; gap entre blocos: 14–16px
- Largura máxima do conteúdo: 460px, centralizado

## Arquitetura de telas (hierarquia)

```
Início (hub)
├── Iniciar sessão ──► Sessão de estudo (imersiva)
│                        ├── × sair ──► Início
│                        └── fim da fila ──► Resumo
│                                             ├── Nova sessão ──► Sessão
│                                             └── Voltar ──► Início
├── Estatísticas (← voltar)
└── Ajustes (← voltar; inclui alternância de tema e URL do Apps Script)
```

Regras:
- O estudo é tela cheia, sem menu — só progresso, card e sair.
- Filtro de idioma (Todas / Inglês / Francês) escolhido no hub, antes da sessão.
- Estatísticas e Ajustes nunca aparecem durante o estudo.

## Formato
- App em moldura Android (412×892, status bar + gesture nav), conteúdo em coluna única

## Interações
- **Toque no card** → vira (rotateY 180°, 0.5s, cubic-bezier(.4,.1,.2,1))
- **Avaliação por 3 botões** (aparecem sob o card quando virado):
  - **Difícil** — volta amanhã (caixa 0), borda 1.5px na cor `hard`
  - **Médio** — volta em 3 dias (mantém a caixa), borda neutra
  - **Fácil** — volta em 7 dias (sobe de caixa), borda 1.5px na cor `easy`
- **Áudio**: Web Speech API (`SpeechSynthesisUtterance`), `en-US` / `fr-FR`, para palavra, frase original e exemplos

## Integração (mantida do app atual)
- Fonte de dados: Google Sheets via Apps Script Web App (URL configurada em Ajustes)
- Progresso gravado na aba **Progresso**; a aba de palavras nunca é alterada
- Sistema de caixas (Leitner): difícil → caixa 0 (amanhã), médio → mantém a caixa (3 dias), fácil → sobe caixa (7 dias)

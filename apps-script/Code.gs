/**
 * Backend de revisão espaçada — Google Apps Script.
 *
 * Instale este script DENTRO da planilha de vocabulário (Extensões → Apps Script)
 * e publique como App da Web (veja apps-script/README.md).
 *
 * A PRIMEIRA aba da planilha é a fonte das palavras/expressões e NUNCA é
 * modificada automaticamente. Modelo de colunas atual (a ordem não importa):
 *   ID | Texto original | Expressão | Língua | Tipo | IPA | Comentário IPA |
 *   Tradução | Exemplo 1 | Tradução 1 | ... | Exemplo 9 | Tradução 9
 *
 * A quantidade de exemplos é livre: o script lê todas as colunas "Exemplo N"
 * (com a "Tradução N" correspondente) e as devolve em ordem numérica. O app
 * mostra 3 sorteadas e guarda o resto para o botão "mais exemplos".
 *
 * Compatível também com o modelo antigo (Texto | Tipo | IPA | Traduções | Contexto | ...).
 *
 * O progresso do usuário é gravado na aba "Progresso", criada automaticamente.
 */

const PROGRESS_SHEET = 'Progresso'
const PROGRESS_HEADERS = [
  'id', 'texto', 'caixa', 'repeticoes', 'dificeis',
  'ultimaResposta', 'ultimaRevisao', 'proximaRevisao', 'atualizadoEm',
]

// Escada de intervalos (dias) por caixa. "Tempo padrão" sobe 1 caixa,
// "muito tempo" sobe 2, "pouco tempo" desce 1 e volta amanhã.
const INTERVALS = [1, 3, 7, 16, 35, 70, 140]
const SHORT_INTERVAL_DAYS = 1

/** Menu para ações manuais (opcionais) na planilha. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Revisão')
    .addItem('Preencher IDs faltantes', 'fillMissingIds')
    .addToUi()
}

function doGet(event) {
  try {
    const params = (event && event.parameter) || {}
    const action = params.action || 'cards'
    if (action === 'ping') return json_({ ok: true, version: 3 })
    if (action === 'cards') return json_({ ok: true, today: dateKey_(new Date()), cards: getCards_() })
    if (action === 'translate') return json_(translateText_(params))
    if (action === 'examples') return json_(generateExamples_(params))
    return json_({ ok: false, error: 'Ação desconhecida: ' + action })
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) })
  }
}

function doPost(event) {
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || '{}')
    if (payload.action === 'review') {
      return json_({ ok: true, saved: [saveReview_(payload)] })
    }
    if (payload.action === 'reviewBatch') {
      const saved = (payload.reviews || []).map(function (review) { return saveReview_(review) })
      return json_({ ok: true, saved: saved })
    }
    return json_({ ok: false, error: 'Ação desconhecida.' })
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) })
  }
}

// ---------------------------------------------------------------- leitura

function getCards_() {
  const source = sourceSheet_()
  const values = source.getDataRange().getValues()
  if (values.length < 2) return []

  const map = mapHeaders_(values[0])
  const progressById = readProgress_()

  const cards = []
  for (let i = 1; i < values.length; i++) {
    const row = values[i]
    const text = cell_(row, map.text)
    if (!text) continue
    const id = cardId_(row, map, text)
    const progress = progressById[id] || null

    const examples = []
    for (let e = 0; e < map.examples.length; e++) {
      const sentence = cell_(row, map.examples[e].text)
      if (!sentence) continue
      examples.push({ text: sentence, translation: cell_(row, map.examples[e].translation) })
    }

    const conjugations = []
    Object.keys(map.tenses).forEach(function (tenseKey) {
      const slot = map.tenses[tenseKey]
      const fr = cell_(row, slot.fr)
      if (!fr) return
      conjugations.push({ tense: slot.label, fr: fr, pt: cell_(row, slot.pt) })
    })

    cards.push({
      id: id,
      text: text,
      original: cell_(row, map.original),
      type: cell_(row, map.type),
      grammarClass: cell_(row, map.grammarClass),
      verbType: cell_(row, map.verbType),
      conjugations: conjugations,
      ipa: cell_(row, map.ipa),
      ipaComment: cell_(row, map.ipaComment),
      translation: cell_(row, map.translation),
      examples: examples,
      language: cell_(row, map.language),
      box: progress ? Number(progress.caixa) || 0 : 0,
      repetitions: progress ? Number(progress.repeticoes) || 0 : 0,
      hardCount: progress ? Number(progress.dificeis) || 0 : 0,
      lastResult: progress ? String(progress.ultimaResposta || '') : '',
      lastReviewedAt: progress ? maybeDateKey_(progress.ultimaRevisao) : '',
      nextReview: progress ? maybeDateKey_(progress.proximaRevisao) : '',
    })
  }
  return cards
}

/**
 * Chave de progresso estável. Usa o ID numérico da planilha quando existe;
 * senão, deriva de língua + expressão (+ texto original para desambiguar),
 * de modo que o app funcione mesmo sem IDs preenchidos.
 */
function cardId_(row, map, text) {
  const explicit = cell_(row, map.id)
  if (explicit) return explicit
  const lang = normalizeLangKey_(cell_(row, map.language))
  const original = cell_(row, map.original)
  const base = lang + ':' + slug_(text) + (original && original.toLowerCase() !== text.toLowerCase() ? ':' + slug_(original) : '')
  return base
}

/**
 * Tradução sob demanda de um trecho selecionado no app (usa o serviço de
 * tradução do próprio Apps Script). Não altera nenhuma planilha.
 */
function translateText_(params) {
  const text = String(params.q || '').trim()
  if (!text) return { ok: false, error: 'Envie o texto em q.' }
  const source = String(params.from || 'fr')
  const target = String(params.to || 'pt')
  try {
    return { ok: true, q: text, translation: LanguageApp.translate(text, source, target) }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

/**
 * Gera novas frases de exemplo para uma palavra/expressão, usando a API do
 * Gemini. Opcional: só funciona se você guardar a chave nas propriedades do
 * script (Configurações do projeto → Propriedades do script →
 * GEMINI_API_KEY). Sem chave, o app usa apenas os exemplos da planilha.
 */
function generateExamples_(params) {
  const term = String(params.q || '').trim()
  if (!term) return { ok: false, error: 'Envie a palavra em q.' }

  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
  if (!key) return { ok: false, error: 'sem-chave', hint: 'Defina GEMINI_API_KEY nas propriedades do script.' }

  const language = String(params.lang || 'fr') === 'en' ? 'inglês' : 'francês'
  const avoid = String(params.avoid || '')
  const prompt =
    'Escreva 3 frases curtas e naturais em ' + language + ' usando "' + term + '". ' +
    'Cada frase deve ter no máximo 12 palavras e vir com a tradução em português do Brasil. ' +
    (avoid ? 'Não repita estas frases: ' + avoid + '. ' : '') +
    'Responda SOMENTE com JSON no formato: ' +
    '{"examples":[{"text":"frase","translation":"tradução"}]}'

  try {
    const response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1, responseMimeType: 'application/json' },
        }),
      },
    )
    const body = JSON.parse(response.getContentText())
    const text = body && body.candidates && body.candidates[0] &&
      body.candidates[0].content && body.candidates[0].content.parts[0].text
    if (!text) return { ok: false, error: 'Resposta vazia do gerador.' }
    const parsed = JSON.parse(text)
    const examples = (parsed.examples || [])
      .filter(function (item) { return item && item.text })
      .slice(0, 3)
      .map(function (item) { return { text: String(item.text), translation: String(item.translation || '') } })
    if (!examples.length) return { ok: false, error: 'Nenhum exemplo gerado.' }
    return { ok: true, q: term, examples: examples }
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) }
  }
}

// ---------------------------------------------------------------- escrita

function saveReview_(payload) {
  const id = String(payload.id || '').trim()
  const result = String(payload.result || '').trim()
  if (!id) throw new Error('Envie o campo id.')
  if (['short', 'standard', 'long'].indexOf(result) < 0) {
    throw new Error('result deve ser short, standard ou long.')
  }

  const lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    const sheet = progressSheet_()
    const finder = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
      .createTextFinder(id).matchEntireCell(true).findNext()

    const existingRow = finder ? finder.getRow() : 0
    const currentBox = existingRow
      ? Number(sheet.getRange(existingRow, 3).getValue()) || 0
      : 0
    const currentReps = existingRow
      ? Number(sheet.getRange(existingRow, 4).getValue()) || 0
      : 0
    const currentHard = existingRow
      ? Number(sheet.getRange(existingRow, 5).getValue()) || 0
      : 0

    const next = schedule_(currentBox, result)
    const today = new Date()
    const rowValues = [
      id,
      String(payload.text || ''),
      next.box,
      currentReps + 1,
      currentHard + (result === 'short' ? 1 : 0),
      result,
      dateKey_(today),
      dateKey_(addDays_(today, next.days)),
      new Date().toISOString(),
    ]

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues])
    } else {
      sheet.appendRow(rowValues)
    }

    return { id: id, box: next.box, nextReview: dateKey_(addDays_(today, next.days)), intervalDays: next.days }
  } finally {
    lock.releaseLock()
  }
}

function schedule_(box, result) {
  const maxBox = INTERVALS.length - 1
  if (result === 'short') {
    return { box: Math.max(0, box - 1), days: SHORT_INTERVAL_DAYS }
  }
  if (result === 'long') {
    const nextBox = Math.min(maxBox, box + 2)
    return { box: nextBox, days: INTERVALS[nextBox] }
  }
  const nextBox = Math.min(maxBox, box + 1)
  return { box: nextBox, days: INTERVALS[Math.min(maxBox, box)] }
}

// ------------------------------------------------- ação manual: IDs

/**
 * Preenche a coluna ID nas linhas em que estiver vazia, com números
 * sequenciais que continuam a partir do maior ID já existente.
 * Executado apenas sob demanda pelo menu "Revisão" (nunca automático).
 */
function fillMissingIds() {
  const sheet = sourceSheet_()
  const range = sheet.getDataRange()
  const values = range.getValues()
  if (values.length < 2) return
  const map = mapHeaders_(values[0])
  if (map.id < 0) {
    SpreadsheetApp.getUi().alert('Não encontrei uma coluna "ID" na primeira aba.')
    return
  }

  let maxId = 0
  for (let i = 1; i < values.length; i++) {
    const value = Number(values[i][map.id])
    if (value > maxId) maxId = value
  }

  let filled = 0
  for (let i = 1; i < values.length; i++) {
    const hasText = String(values[i][map.text] || '').trim()
    const hasId = String(values[i][map.id] || '').trim()
    if (hasText && !hasId) {
      maxId += 1
      sheet.getRange(i + 1, map.id + 1).setValue(maxId)
      filled += 1
    }
  }
  SpreadsheetApp.getUi().alert(filled ? filled + ' ID(s) preenchido(s).' : 'Nenhum ID faltando.')
}

// ---------------------------------------------------------------- infra

function sourceSheet_() {
  const spreadsheet = SpreadsheetApp.getActive()
  const named = PropertiesService.getScriptProperties().getProperty('SOURCE_SHEET')
  if (named) {
    const sheet = spreadsheet.getSheetByName(named)
    if (sheet) return sheet
  }
  const sheets = spreadsheet.getSheets()
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() !== PROGRESS_SHEET) return sheets[i]
  }
  throw new Error('Nenhuma aba de palavras encontrada.')
}

function progressSheet_() {
  const spreadsheet = SpreadsheetApp.getActive()
  let sheet = spreadsheet.getSheetByName(PROGRESS_SHEET)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PROGRESS_SHEET)
    sheet.appendRow(PROGRESS_HEADERS)
    sheet.setFrozenRows(1)
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(PROGRESS_HEADERS)
    sheet.setFrozenRows(1)
  }
  return sheet
}

function readProgress_() {
  const sheet = progressSheet_()
  if (sheet.getLastRow() < 2) return {}
  const values = sheet.getDataRange().getValues()
  const headers = values[0].map(function (header) { return String(header).trim() })
  const byId = {}
  for (let i = 1; i < values.length; i++) {
    const item = {}
    for (let j = 0; j < headers.length; j++) item[headers[j]] = values[i][j]
    if (item.id) byId[String(item.id)] = item
  }
  return byId
}

/**
 * Casa os cabeçalhos reais da planilha (com acentos/variações) com campos
 * internos. Suporta o modelo novo (Expressão + exemplos) e o antigo (Texto).
 */
function mapHeaders_(headerRow) {
  const index = {
    id: -1, text: -1, original: -1, language: -1, type: -1,
    ipa: -1, ipaComment: -1, translation: -1, context: -1, chapter: -1, source: -1,
    grammarClass: -1, verbType: -1,
    examples: [],
    tenses: {
      present: { label: 'Présent', fr: -1, pt: -1 },
      passeCompose: { label: 'Passé composé', fr: -1, pt: -1 },
      imparfait: { label: 'Imparfait', fr: -1, pt: -1 },
      futur: { label: 'Futur simple', fr: -1, pt: -1 },
    },
  }
  const exampleTexts = {}
  const exampleTranslations = {}

  for (let i = 0; i < headerRow.length; i++) {
    const key = normalizeKey_(headerRow[i])
    if (key === 'id') index.id = i
    else if (key === 'expressao' || key === 'palavra') index.text = i
    else if (key.indexOf('texto original') === 0 || key === 'original') index.original = i
    else if (key === 'idioma' || key === 'lingua' || key === 'language') index.language = i
    else if (key === 'tipo' || key === 'type') index.type = i
    else if (key.indexOf('classe gramatical') === 0 || key === 'classe') index.grammarClass = i
    else if (key.indexOf('conjugacao') === 0) index.verbType = i
    else if (key.indexOf('present') === 0) tense_(index.tenses.present, key, i)
    else if (key.indexOf('passe compose') === 0) tense_(index.tenses.passeCompose, key, i)
    else if (key.indexOf('imparfait') === 0) tense_(index.tenses.imparfait, key, i)
    else if (key.indexOf('futur') === 0) tense_(index.tenses.futur, key, i)
    else if (key.indexOf('comentario ipa') === 0 || key === 'comentario pronuncia') index.ipaComment = i
    else if (key === 'ipa' || key === 'pronuncia') index.ipa = i
    else if (key === 'contexto' || key === 'context' || key === 'frase') index.context = i
    else if (key === 'capitulo' || key === 'chapter') index.chapter = i
    else if (key === 'fonte' || key === 'source' || key === 'origem') index.source = i
    else {
      const exampleMatch = key.match(/^exemplo\s*(\d+)$/)
      const translationMatch = key.match(/^traduc(?:ao|oes)\s*(\d+)$/)
      if (exampleMatch) exampleTexts[exampleMatch[1]] = i
      else if (translationMatch) exampleTranslations[translationMatch[1]] = i
      else if (key.indexOf('traduc') === 0 || key === 'translation' || key === 'significado') index.translation = i
    }
  }

  // Modelo antigo: a frente vinha da coluna "Texto"; o contexto virava exemplo.
  if (index.text < 0) {
    for (let i = 0; i < headerRow.length; i++) {
      if (normalizeKey_(headerRow[i]) === 'texto') { index.text = i; break }
    }
  }

  Object.keys(exampleTexts)
    .sort(function (a, b) { return Number(a) - Number(b) })
    .forEach(function (n) {
      index.examples.push({ text: exampleTexts[n], translation: exampleTranslations[n] != null ? exampleTranslations[n] : -1 })
    })

  // Sem exemplos estruturados, aproveita a coluna de contexto do modelo antigo.
  if (!index.examples.length && index.context >= 0) {
    index.examples.push({ text: index.context, translation: -1 })
  }

  if (index.text < 0) throw new Error('A aba precisa de uma coluna "Expressão" (ou "Texto").')
  return index
}

/** Coluna de tempo verbal: com "tradução" no nome é a versão PT, senão a FR. */
function tense_(slot, key, columnIndex) {
  if (key.indexOf('traducao') >= 0) slot.pt = columnIndex
  else slot.fr = columnIndex
}

function normalizeKey_(raw) {
  return String(raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function normalizeLangKey_(value) {
  const key = normalizeKey_(value)
  if (key.indexOf('fr') === 0) return 'fr'
  if (key.indexOf('in') === 0 || key.indexOf('en') === 0) return 'en'
  return key || 'xx'
}

function slug_(value) {
  return normalizeKey_(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function cell_(row, columnIndex) {
  if (columnIndex < 0) return ''
  const value = row[columnIndex]
  if (value === null || value === undefined) return ''
  if (Object.prototype.toString.call(value) === '[object Date]') return dateKey_(value)
  return String(value).trim()
}

function addDays_(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + Number(days || 0))
  return next
}

function maybeDateKey_(value) {
  if (!value) return ''
  if (Object.prototype.toString.call(value) === '[object Date]') return dateKey_(value)
  return String(value)
}

function dateKey_(date) {
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON)
}

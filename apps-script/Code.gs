/**
 * Backend de revisão espaçada — Google Apps Script.
 *
 * Instale este script DENTRO da planilha de vocabulário (Extensões → Apps Script)
 * e publique como App da Web (veja apps-script/README.md).
 *
 * A PRIMEIRA aba da planilha é a fonte das palavras/expressões e NUNCA é
 * modificada por este script. Colunas reconhecidas (a ordem não importa):
 *   Texto | Tipo | IPA | Traduções | Contexto | Capítulo | Fonte |
 *   Salva em (app) | Recebida em | ID | Idioma (opcional)
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

function doGet(event) {
  try {
    const params = (event && event.parameter) || {}
    const action = params.action || 'cards'
    if (action === 'ping') return json_({ ok: true, version: 2 })
    if (action === 'cards') return json_({ ok: true, today: dateKey_(new Date()), cards: getCards_() })
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

  const headerIndex = mapHeaders_(values[0])
  const progressById = readProgress_()

  const cards = []
  for (let i = 1; i < values.length; i++) {
    const row = values[i]
    const text = cell_(row, headerIndex.text)
    if (!text) continue
    const id = cell_(row, headerIndex.id) || 'txt:' + text.toLowerCase()
    const progress = progressById[id] || null
    cards.push({
      id: id,
      text: text,
      type: cell_(row, headerIndex.type),
      ipa: cell_(row, headerIndex.ipa),
      translation: cell_(row, headerIndex.translation),
      context: cell_(row, headerIndex.context),
      chapter: cell_(row, headerIndex.chapter),
      source: cell_(row, headerIndex.source),
      language: cell_(row, headerIndex.language),
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

/** Casa os cabeçalhos reais da planilha (com acentos/variações) com campos internos. */
function mapHeaders_(headerRow) {
  const index = { text: -1, type: -1, ipa: -1, translation: -1, context: -1, chapter: -1, source: -1, id: -1, language: -1 }
  for (let i = 0; i < headerRow.length; i++) {
    const raw = String(headerRow[i] || '')
    const key = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    if (key === 'texto' || key === 'text' || key === 'expressao' || key === 'palavra') index.text = i
    else if (key === 'tipo' || key === 'type') index.type = i
    else if (key === 'ipa' || key === 'pronuncia') index.ipa = i
    else if (key.indexOf('traduc') === 0 || key === 'translation' || key === 'significado') index.translation = i
    else if (key === 'contexto' || key === 'context' || key === 'frase') index.context = i
    else if (key === 'capitulo' || key === 'chapter') index.chapter = i
    else if (key === 'fonte' || key === 'source' || key === 'origem') index.source = i
    else if (key === 'id') index.id = i
    else if (key === 'idioma' || key === 'lingua' || key === 'language') index.language = i
  }
  if (index.text < 0) throw new Error('A aba de palavras precisa de uma coluna "Texto".')
  return index
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

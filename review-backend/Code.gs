// A aba "palavras" é a fonte dos cards. O script NUNCA altera o cabeçalho
// nem limpa essa aba, porque ela pode conter fórmulas como IMPORTRANGE.
const EXPRESSIONS_SHEET = 'palavras'
const PROGRESS_SHEET = 'Progresso'
const DEFAULT_INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120]
const PROGRESS_HEADERS = ['expressionId', 'box', 'repetitions', 'lapses', 'lastResult', 'lastReviewedAt', 'nextReview', 'updatedAt']

function doGet(event) {
  ensureSchema_()
  const params = event.parameter || {}
  const action = params.action || 'due'

  if (action === 'all') return json_(getAllCards_())
  if (action === 'progress') return json_(getProgress_(params))
  if (action === 'stats') return json_(getStats_())
  if (action === 'schema') return json_(getSchema_())
  return json_(getDueCards_(params))
}

function doPost(event) {
  ensureSchema_()
  const payload = JSON.parse((event.postData && event.postData.contents) || '{}')
  if (payload.action === 'review') return json_(saveReview_(payload))
  if (payload.action === 'upsertExpression') return json_(upsertExpression_(payload.expression || {}))
  throw new Error('Ação inválida. Use action=review ou action=upsertExpression.')
}

function getDueCards_(params) {
  const today = toDateKey_(new Date())
  const language = params.language || 'all'
  return getAllCards_().filter((card) => {
    const matchesLanguage = language === 'all' || card.language === language
    return matchesLanguage && card.nextReview <= today
  })
}

function getProgress_(params) {
  const rows = readTable_(PROGRESS_SHEET).map((row) => ({
    expressionId: String(row.expressionId || ''),
    box: Number(row.box || 1),
    repetitions: Number(row.repetitions || 0),
    lapses: Number(row.lapses || 0),
    lastResult: row.lastResult || '',
    lastReviewedAt: formatMaybeDate_(row.lastReviewedAt),
    nextReview: formatMaybeDate_(row.nextReview),
    updatedAt: row.updatedAt || '',
  }))

  if (params.expressionId) {
    return rows.find((row) => row.expressionId === String(params.expressionId)) || null
  }

  return rows
}

function getStats_() {
  const cards = getAllCards_()
  const today = toDateKey_(new Date())
  const reviewed = cards.filter((card) => card.repetitions > 0)
  return {
    totalExpressions: cards.length,
    dueToday: cards.filter((card) => card.nextReview <= today).length,
    reviewedExpressions: reviewed.length,
    totalReviews: reviewed.reduce((sum, card) => sum + card.repetitions, 0),
    totalLapses: reviewed.reduce((sum, card) => sum + card.lapses, 0),
    byLanguage: cards.reduce((index, card) => {
      index[card.language] = (index[card.language] || 0) + 1
      return index
    }, {}),
  }
}

function getAllCards_() {
  const expressions = readTable_(EXPRESSIONS_SHEET)
  const progressById = readTable_(PROGRESS_SHEET).reduce((index, row) => {
    index[row.expressionId] = row
    return index
  }, {})

  return expressions
    .map(normalizeExpressionRow_)
    .filter((card) => card.id && card.expression)
    .map((card) => {
      const progress = progressById[card.id] || {}
      return {
        ...card,
        box: Number(progress.box || 1),
        repetitions: Number(progress.repetitions || 0),
        lapses: Number(progress.lapses || 0),
        lastResult: progress.lastResult || '',
        lastReviewedAt: formatMaybeDate_(progress.lastReviewedAt),
        nextReview: formatMaybeDate_(progress.nextReview) || toDateKey_(new Date()),
      }
    })
}

function normalizeExpressionRow_(row) {
  const expression = getFirstValue_(row, ['expression', 'expressao', 'expressão', 'texto', 'Text', 'Texto'])
  const id = getFirstValue_(row, ['id', 'ID', 'Id']) || makeStableId_(expression, getFirstValue_(row, ['Recebida em', 'Salva em (app)', 'createdAt']))
  const type = getFirstValue_(row, ['Tipo', 'type', 'tags'])
  const chapter = getFirstValue_(row, ['Capítulo', 'Capitulo', 'chapter'])
  const source = getFirstValue_(row, ['Fonte', 'source'])
  return {
    id: String(id || ''),
    expression: String(expression || ''),
    translation: getFirstValue_(row, ['translation', 'tradução', 'traducoes', 'traduções', 'Traduções']) || '',
    context: getFirstValue_(row, ['context', 'Contexto', 'exemplo', 'example']) || '',
    language: normalizeLanguage_(getFirstValue_(row, ['language', 'idioma', 'Idioma'])),
    ipa: getFirstValue_(row, ['IPA', 'ipa']) || '',
    tags: [type, chapter, source].filter(Boolean).join(' · '),
    createdAt: formatMaybeDate_(getFirstValue_(row, ['createdAt', 'Salva em (app)', 'Recebida em'])) || '',
  }
}

function saveReview_(payload) {
  const result = payload.result
  if (!payload.expressionId || !['again', 'hard', 'good', 'easy'].includes(result)) {
    throw new Error('Envie expressionId e result: again, hard, good ou easy.')
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(PROGRESS_SHEET)
  const table = readTable_(PROGRESS_SHEET)
  const rowIndex = table.findIndex((row) => String(row.expressionId) === String(payload.expressionId))
  const current = rowIndex >= 0 ? table[rowIndex] : {}
  const currentBox = Number(current.box || 1)
  const direction = result === 'again' ? -1 : result === 'hard' ? 0 : result === 'good' ? 1 : 2
  const nextBox = Math.min(DEFAULT_INTERVALS.length - 1, Math.max(1, currentBox + direction))
  const today = new Date()
  const nextReview = addDays_(today, result === 'again' ? 0 : DEFAULT_INTERVALS[nextBox])

  const updated = [
    String(payload.expressionId),
    nextBox,
    Number(current.repetitions || 0) + 1,
    Number(current.lapses || 0) + (result === 'again' ? 1 : 0),
    result,
    toDateKey_(today),
    toDateKey_(nextReview),
    new Date().toISOString(),
  ]

  if (rowIndex >= 0) {
    sheet.getRange(rowIndex + 2, 1, 1, updated.length).setValues([updated])
  } else {
    sheet.appendRow(updated)
  }

  return { ok: true, expressionId: String(payload.expressionId), box: nextBox, nextReview: toDateKey_(nextReview) }
}

function upsertExpression_(expression) {
  if (!expression.expression) throw new Error('Campo expression é obrigatório.')
  const sheet = SpreadsheetApp.getActive().getSheetByName(EXPRESSIONS_SHEET)
  if (!sheet) throw new Error(`A aba ${EXPRESSIONS_SHEET} não existe.`)

  const headers = getHeaders_(sheet)
  if (!headers.length) throw new Error(`A aba ${EXPRESSIONS_SHEET} precisa ter cabeçalhos antes de inserir dados.`)

  const table = readTable_(EXPRESSIONS_SHEET)
  const id = expression.id || Utilities.getUuid()
  const rowIndex = table.findIndex((item) => String(getFirstValue_(item, ['id', 'ID', 'Id'])) === String(id))
  const row = headers.map((header) => valueForHeader_(header, expression, id))

  if (rowIndex >= 0) sheet.getRange(rowIndex + 2, 1, 1, row.length).setValues([row])
  else sheet.appendRow(row)
  return { ok: true, id }
}

function ensureSchema_() {
  const spreadsheet = SpreadsheetApp.getActive()
  const expressionsSheet = spreadsheet.getSheetByName(EXPRESSIONS_SHEET)
  if (!expressionsSheet) {
    throw new Error(`A aba ${EXPRESSIONS_SHEET} não existe. Crie/recupere essa aba; o script não cria nem altera a fonte importada.`)
  }
  ensureProgressSheet_(spreadsheet)
}

function ensureProgressSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(PROGRESS_SHEET) || spreadsheet.insertSheet(PROGRESS_SHEET)
  if (sheet.getLastRow() === 0) sheet.appendRow(PROGRESS_HEADERS)
}

function readTable_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName)
  if (!sheet || sheet.getLastRow() < 2) return []
  const values = sheet.getDataRange().getValues()
  const headers = values.shift().map((header) => String(header).trim())
  return values.map((row) => headers.reduce((item, header, index) => {
    item[header] = row[index]
    return item
  }, {}))
}

function getHeaders_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return []
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((header) => String(header).trim())
}

function getSchema_() {
  return {
    expressionsSheet: EXPRESSIONS_SHEET,
    progressSheet: PROGRESS_SHEET,
    expressionsColumnsAccepted: {
      id: ['ID', 'id', 'Id'],
      expression: ['Texto', 'expression', 'expressao', 'expressão'],
      translation: ['Traduções', 'translation', 'tradução'],
      context: ['Contexto', 'context'],
      language: ['Idioma', 'language'],
      tags: ['Tipo', 'Capítulo', 'Fonte'],
    },
    progressColumns: PROGRESS_HEADERS,
  }
}

function valueForHeader_(header, expression, id) {
  const normalized = normalizeKey_(header)
  if (['id'].includes(normalized)) return id
  if (['texto', 'expression', 'expressao'].includes(normalized)) return expression.expression || ''
  if (['tipo', 'type'].includes(normalized)) return expression.type || expression.tags || ''
  if (['ipa'].includes(normalized)) return expression.ipa || ''
  if (['traducoes', 'traducao', 'translation'].includes(normalized)) return expression.translation || ''
  if (['contexto', 'context'].includes(normalized)) return expression.context || ''
  if (['capitulo', 'chapter'].includes(normalized)) return expression.chapter || ''
  if (['fonte', 'source'].includes(normalized)) return expression.source || ''
  if (['salva em app', 'createdat'].includes(normalized)) return expression.createdAt || toDateKey_(new Date())
  if (['recebida em'].includes(normalized)) return expression.receivedAt || toDateKey_(new Date())
  if (['idioma', 'language'].includes(normalized)) return normalizeLanguage_(expression.language)
  return ''
}

function getFirstValue_(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key]
  }
  const normalizedRow = Object.keys(row).reduce((index, key) => {
    index[normalizeKey_(key)] = row[key]
    return index
  }, {})
  for (const key of keys) {
    const value = normalizedRow[normalizeKey_(key)]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return ''
}

function normalizeKey_(key) {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function makeStableId_(expression, seed) {
  if (!expression) return ''
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, `${expression}|${seed || ''}`)
  return digest.map((byte) => (`0${(byte & 0xff).toString(16)}`).slice(-2)).join('')
}

function normalizeLanguage_(language) {
  const value = String(language || '').toLowerCase()
  if (value.startsWith('fr')) return 'fr-FR'
  return 'en-US'
}

function addDays_(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + Number(days || 0))
  return next
}

function formatMaybeDate_(value) {
  if (!value) return ''
  if (Object.prototype.toString.call(value) === '[object Date]') return toDateKey_(value)
  return String(value)
}

function toDateKey_(date) {
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON)
}

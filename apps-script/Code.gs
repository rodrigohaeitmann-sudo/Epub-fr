const EXPRESSIONS_SHEET = 'Expressoes'
const PROGRESS_SHEET = 'Progresso'
const DEFAULT_INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120]

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
    .filter((row) => row.id && row.expression)
    .map((row) => {
      const progress = progressById[row.id] || {}
      return {
        id: String(row.id),
        expression: row.expression,
        translation: row.translation || '',
        context: row.context || '',
        language: normalizeLanguage_(row.language),
        tags: row.tags || '',
        box: Number(progress.box || 1),
        repetitions: Number(progress.repetitions || 0),
        lapses: Number(progress.lapses || 0),
        lastResult: progress.lastResult || '',
        lastReviewedAt: formatMaybeDate_(progress.lastReviewedAt),
        nextReview: formatMaybeDate_(progress.nextReview) || toDateKey_(new Date()),
      }
    })
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
  const table = readTable_(EXPRESSIONS_SHEET)
  const id = expression.id || Utilities.getUuid()
  const row = [
    id,
    expression.expression,
    normalizeLanguage_(expression.language),
    expression.translation || '',
    expression.context || '',
    expression.tags || '',
    expression.createdAt || toDateKey_(new Date()),
  ]
  const rowIndex = table.findIndex((item) => String(item.id) === String(id))
  if (rowIndex >= 0) sheet.getRange(rowIndex + 2, 1, 1, row.length).setValues([row])
  else sheet.appendRow(row)
  return { ok: true, id }
}

function ensureSchema_() {
  const spreadsheet = SpreadsheetApp.getActive()
  ensureSheet_(spreadsheet, EXPRESSIONS_SHEET, ['id', 'expression', 'language', 'translation', 'context', 'tags', 'createdAt'])
  ensureSheet_(spreadsheet, PROGRESS_SHEET, ['expressionId', 'box', 'repetitions', 'lapses', 'lastResult', 'lastReviewedAt', 'nextReview', 'updatedAt'])
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name)
  if (sheet.getLastRow() === 0) sheet.appendRow(headers)
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0]
  if (currentHeaders.join('|') !== headers.join('|')) sheet.getRange(1, 1, 1, headers.length).setValues([headers])
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

function getSchema_() {
  return {
    expressionsSheet: EXPRESSIONS_SHEET,
    progressSheet: PROGRESS_SHEET,
    expressionsColumns: ['id', 'expression', 'language', 'translation', 'context', 'tags', 'createdAt'],
    progressColumns: ['expressionId', 'box', 'repetitions', 'lapses', 'lastResult', 'lastReviewedAt', 'nextReview', 'updatedAt'],
  }
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

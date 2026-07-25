/**
 * Backend de FRASES — segundo Google Apps Script, independente do de palavras.
 *
 * Instale este script DENTRO da planilha de frases (Extensões → Apps Script),
 * publique como App da Web (mesmos passos do outro script) e cole a URL /exec
 * no campo "URL das frases" em Ajustes, no app.
 *
 * Estrutura esperada da planilha:
 *   - CADA ABA é um TEMA (o nome da aba vira o nome do tema no app);
 *   - abas ignoradas: "Progresso" e qualquer uma cujo nome contenha
 *     "guia" ou "pronúncia" (ex.: "Guia de pronúncia");
 *   - em cada aba, uma frase por linha: coluna com o FRANCÊS e coluna com a
 *     TRADUÇÃO. Se houver cabeçalho, as colunas são achadas pelos nomes
 *     (ex.: "Frase"/"Francês" e "Tradução"/"Português"; opcionalmente uma
 *     coluna "Dica"/"Pronúncia" vira a dica do verso). Sem cabeçalho,
 *     assume-se coluna A = francês e coluna B = tradução.
 *
 * O progresso é gravado na aba "Progresso" desta planilha (criada
 * automaticamente); as abas de frases nunca são alteradas.
 */

const PROGRESS_SHEET = 'Progresso'
const PROGRESS_HEADERS = [
  'id', 'texto', 'caixa', 'repeticoes', 'dificeis',
  'ultimaResposta', 'ultimaRevisao', 'proximaRevisao', 'atualizadoEm',
]

// Mesma escada de intervalos do app e do script de palavras.
const INTERVALS = [1, 3, 7, 16, 35, 70, 140]
const SHORT_INTERVAL_DAYS = 1

function doGet(event) {
  try {
    const params = (event && event.parameter) || {}
    const action = params.action || 'cards'
    if (action === 'ping') return json_({ ok: true, version: 1, kind: 'frases' })
    if (action === 'cards') return json_({ ok: true, today: dateKey_(new Date()), cards: getPhrases_() })
    if (action === 'translate') return json_(translateText_(params))
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

function getPhrases_() {
  const spreadsheet = SpreadsheetApp.getActive()
  const progressById = readProgress_()
  const cards = []

  spreadsheet.getSheets().forEach(function (sheet) {
    const theme = sheet.getName()
    if (isIgnoredSheet_(theme)) return
    if (sheet.getLastRow() < 1) return

    const values = sheet.getDataRange().getValues()
    const layout = detectLayout_(values[0])
    const start = layout.hasHeader ? 1 : 0

    for (let i = start; i < values.length; i++) {
      const row = values[i]
      const fr = cellText_(row[layout.fr])
      if (!fr) continue
      const pt = layout.pt >= 0 ? cellText_(row[layout.pt]) : ''
      const explicitId = layout.id >= 0 ? cellText_(row[layout.id]) : ''
      const id = explicitId || 'phr:' + slug_(theme) + ':' + slug_(fr)
      const progress = progressById[id] || null

      cards.push({
        id: id,
        text: fr,
        original: fr,
        type: 'frase',
        theme: theme,
        ipa: '',
        ipaComment: layout.tip >= 0 ? cellText_(row[layout.tip]) : '',
        translation: pt,
        examples: [],
        conjugations: [],
        language: 'Francês',
        box: progress ? Number(progress.caixa) || 0 : 0,
        repetitions: progress ? Number(progress.repeticoes) || 0 : 0,
        hardCount: progress ? Number(progress.dificeis) || 0 : 0,
        lastResult: progress ? String(progress.ultimaResposta || '') : '',
        lastReviewedAt: progress ? maybeDateKey_(progress.ultimaRevisao) : '',
        nextReview: progress ? maybeDateKey_(progress.proximaRevisao) : '',
      })
    }
  })

  return cards
}

function isIgnoredSheet_(name) {
  const key = normalizeKey_(name)
  return key === normalizeKey_(PROGRESS_SHEET) || key.indexOf('guia') >= 0 || key.indexOf('pronuncia') >= 0
}

/**
 * Descobre as colunas da aba. Com cabeçalho, casa pelos nomes; sem
 * cabeçalho, assume A = francês e B = tradução.
 */
function detectLayout_(firstRow) {
  const layout = { hasHeader: false, fr: 0, pt: 1, tip: -1, id: -1 }
  const keys = firstRow.map(function (cell) { return normalizeKey_(cell) })

  let frCol = -1
  let ptCol = -1
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (!key) continue
    if (frCol < 0 && (key.indexOf('fras') === 0 || key.indexOf('franc') >= 0 || key === 'fr')) frCol = i
    else if (ptCol < 0 && (key.indexOf('tradu') === 0 || key.indexOf('portug') >= 0 || key === 'pt')) ptCol = i
    else if (layout.tip < 0 && (key.indexOf('dica') >= 0 || key.indexOf('pronunc') >= 0 || key.indexOf('coment') >= 0 || key === 'ipa')) layout.tip = i
    else if (layout.id < 0 && key === 'id') layout.id = i
  }

  if (frCol >= 0) {
    layout.hasHeader = true
    layout.fr = frCol
    layout.pt = ptCol >= 0 ? ptCol : (frCol + 1 < firstRow.length ? frCol + 1 : -1)
  }
  return layout
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
    const currentBox = existingRow ? Number(sheet.getRange(existingRow, 3).getValue()) || 0 : 0
    const currentReps = existingRow ? Number(sheet.getRange(existingRow, 4).getValue()) || 0 : 0
    const currentHard = existingRow ? Number(sheet.getRange(existingRow, 5).getValue()) || 0 : 0

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

function normalizeKey_(raw) {
  return String(raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function slug_(value) {
  return normalizeKey_(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function cellText_(value) {
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

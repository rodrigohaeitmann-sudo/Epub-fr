export interface Chapter {
  id: string
  title: string
  paragraphs: string[]
}

export interface AudioChapter {
  title: string
  start: number // seconds
}

export interface Book {
  title: string
  author?: string
  coverUrl?: string
  chapters: Chapter[]
}

export type TrackKey = 'fr' | 'pt'

export type Toggles = Record<TrackKey, boolean>

// PT translation per chapter, indexed by chapter id -> array aligned to paragraphs.
export type Translations = Record<string, string[]>

export interface LoadedBook {
  audioUrl: string
  bookId: string
  book: Book
  audioChapters: AudioChapter[]
}

export interface Settings {
  fontScale: number
  fontFamily: 'system' | 'serif' | 'mono'
  speed: number
  lineOffset: number // visual shift of the PT pane relative to the FR pane, in text lines
}

export interface ReadingPos {
  chapter: number
  paragraph: number
}

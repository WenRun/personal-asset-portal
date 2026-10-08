export type Role = 'admin' | 'member'
export type AssetType = 'font' | 'music' | 'video' | 'book' | 'image'

export interface User {
  id: string
  username: string
  role: Role
}

// ---- 字体 ----
export interface FontAxis { tag: string; min: number; max: number; def: number }
export interface FontFile { styleName: string; weight: number; italic: boolean; format: string; sizeMB: number }
export interface CharsetRow { name: string; pct: number }
export interface FontFamily {
  id: string
  family: string
  familyEn: string
  variable: boolean
  axes: FontAxis[]
  files: FontFile[]
  glyphCount: number
  languages: string[]
  license: string
  version: string
  designer: string
  tags: string[]
  rating: number
  favorite: boolean
  createdAt: string
  charset: CharsetRow[]
  css: string // mock 渲染用的 font-family
}

// ---- 音乐 ----
export interface Track {
  id: string          // = asset_id（流播放按此寻址）
  albumId: string
  no: number
  title: string
  durationSec: number
  bitrateK: number
  lrc: boolean
  streamable?: boolean
}
export interface Album {
  id: string
  title: string
  artist: string
  year: number
  genre: string
  format: string
  khz: number
  bit: number
  hue: number
  tracks: Track[]
  tags: string[]
  rating: number
  favorite: boolean
  createdAt: string
  note: string
}

// ---- 视频 ----
export interface Episode { idx: number; title: string; durationSec: number; playable: boolean }
export interface Series {
  id: string
  title: string
  kind: 'tutorial'
  sizeGB: number
  resolution: string
  codec: string
  playableAll: boolean
  addedAt: string
  hue: number
  watched: number
  tags: string[]
  note: string
  episodes: Episode[]
}
export interface Clip {
  id: string
  kind: 'clip' | 'tutorial'
  title: string
  durationSec: number
  addedAt: string
  playable: boolean
  resolution: string
  sizeMB: number
  hue: number
  codec?: string
  tags?: string[]
  note?: string
  series_id?: string | null
  episode?: number | null
  cover_url?: string | null
  rating?: number
}
export type VideoAsset = Series | Clip

// ---- 书籍 ----
export interface BookFormat { kind: 'EPUB' | 'PDF' | 'MOBI' | 'AZW3'; sizeMB: number; readable: boolean }
export interface Book {
  id: string
  title: string
  author: string
  publisher: string
  year: number
  isbn: string
  series?: { name: string; idx: number; total: number }
  formats: BookFormat[]
  progressPct: number
  lastChapter?: string
  rating: number
  tags: string[]
  hue: number
  createdAt: string
  desc: string
  language: string
}

// ---- 图片 ----
export interface Photo {
  id: string
  title: string
  fileName: string
  takenAt: string
  album: string
  camera: string
  lens: string
  focal: string
  aperture: string
  shutter: string
  iso: number
  w: number
  h: number
  sizeMB: number
  gps: string
  hue: number
  displayH: number
  tags: string[]
  rating: number
  favorite: boolean
}

// ---- 管理 ----
export interface Job {
  id: string
  kind: string
  target: string
  status: 'queued' | 'running' | 'done' | 'failed'
  attempts: number
  at: string
  error?: string
}
export interface ConfirmItem { id: string; file: string; hint: string; seriesGuess: string; episode: number }

export interface Stats {
  fontsFiles: string
  fontFamilies: number
  albums: number
  tracks: number
  seriesCount: number
  clips: number
  books: number
  images: string
  jobsQueued: number
  jobsRunning: number
  jobsFailed: number
  jobsDoneToday: number
}

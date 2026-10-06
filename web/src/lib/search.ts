import { ALBUMS, BOOKS, CLIPS, FONTS, PHOTOS, SERIES } from '@/mocks/data'
import type { AssetType } from '@/types'

export interface Hit {
  to: string
  type: AssetType
  title: string
  sub: string
  hue?: number
  glyph?: string
}

export interface SearchResults {
  fonts: Hit[]
  music: Hit[]
  videos: Hit[]
  books: Hit[]
  images: Hit[]
  total: number
}

const GROUP_LABEL: Record<AssetType, string> = {
  font: '字体', music: '音乐', video: '视频', book: '书籍', image: '图片',
}
export { GROUP_LABEL }

/** Mock 全局搜索：对应 Meilisearch multi-search 聚合（§6.4），M0 后替换为 GET /api/search */
export function searchAll(q: string, perType = 5): SearchResults {
  const s = q.trim().toLowerCase()
  const m = (...ts: string[]) => !s || ts.some((t) => t.toLowerCase().includes(s))

  const fonts = FONTS.filter((f) => m(f.family, f.familyEn, f.tags.join()))
  const music = ALBUMS.filter((a) => m(a.title, a.artist, a.genre, ...a.tags))
  const videos = [...SERIES, ...CLIPS].filter((v) => m(v.title, v.tags?.join?.() ?? ''))
  const books = BOOKS.filter((b) => m(b.title, b.author, b.publisher, ...b.tags))
  const images = PHOTOS.filter((p) => m(p.title, p.fileName, ...p.tags))

  const cut = (arr: Hit[]) => arr.slice(0, perType)
  return {
    fonts: cut(fonts.map((f) => ({ to: `/fonts/${f.id}`, type: 'font', title: f.family, sub: `${f.files.length} 字重 · ${f.languages.join('/')}`, glyph: f.family[0], hue: 245 }))),
    music: cut(music.map((a) => ({ to: `/music/albums/${a.id}`, type: 'music', title: a.title, sub: `${a.artist} · ${a.year} · ${a.format}`, hue: a.hue, glyph: '♪' }))),
    videos: cut(videos.map((v) => ({ to: `/videos/${v.id}`, type: 'video', title: v.title, sub: v.kind === 'tutorial' ? `教程系列 · ${v.sizeGB}GB` : `素材 · ${v.resolution}`, hue: v.hue, glyph: '▶' }))),
    books: cut(books.map((b) => ({ to: `/books/${b.id}`, type: 'book', title: b.title, sub: `${b.author} · ${b.formats.map((f) => f.kind).join('/')}`, hue: b.hue, glyph: '📖' }))),
    images: cut(images.map((p) => ({ to: `/images/${p.id}`, type: 'image', title: p.title, sub: `${p.camera} · ${p.fileName}`, hue: p.hue, glyph: '🖼' }))),
    total: fonts.length + music.length + videos.length + books.length + images.length,
  }
}

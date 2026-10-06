import {
  ALBUMS, BOOKS, CLIPS, CONFIRM_ITEMS, FONTS, JOBS, PHOTOS, SERIES, STATS, TAGS,
} from '@/mocks/data'
import type { Album, Book, Clip, ConfirmItem, FontFamily, Job, Photo, Series, Stats } from '@/types'

const delay = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms))

export interface TagItem { id: string; name: string; count: number }

/**
 * Mock API 层：签名与将来的真实 REST API 一致，
 * M0 后端就绪后逐个替换为 fetch('/api/...') 实现，页面代码无需改动。
 */
export const api = {
  async stats(): Promise<Stats> { await delay(); return STATS },

  async fonts(): Promise<FontFamily[]> { await delay(); return FONTS },
  async font(id: string): Promise<FontFamily | undefined> {
    await delay(); return FONTS.find((f) => f.id === id)
  },

  async albums(): Promise<Album[]> { await delay(); return ALBUMS },
  async album(id: string): Promise<Album | undefined> {
    await delay(); return ALBUMS.find((a) => a.id === id)
  },

  async series(): Promise<Series[]> { await delay(); return SERIES },
  async clips(): Promise<Clip[]> { await delay(); return CLIPS },
  async video(id: string): Promise<Series | Clip | undefined> {
    await delay(); return [...SERIES, ...CLIPS].find((v) => v.id === id)
  },

  async books(): Promise<Book[]> { await delay(); return BOOKS },
  async book(id: string): Promise<Book | undefined> {
    await delay(); return BOOKS.find((b) => b.id === id)
  },

  async photos(): Promise<Photo[]> { await delay(); return PHOTOS },
  async photo(id: string): Promise<Photo | undefined> {
    await delay(); return PHOTOS.find((p) => p.id === id)
  },

  async jobs(): Promise<Job[]> { await delay(); return JOBS },
  async confirmItems(): Promise<ConfirmItem[]> { await delay(); return CONFIRM_ITEMS },
  async tags(): Promise<TagItem[]> { await delay(); return TAGS },
}

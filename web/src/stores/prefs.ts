import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface BookProgress { pct: number; chapter: string; page: number; total: number }
interface VideoProgress { ep: number; pos: number }

interface PrefsState {
  // 字体预览（样张墙全局文案）
  fontText: string
  fontSize: number
  fontWeight: number
  setFontPreview: (p: Partial<Pick<PrefsState, 'fontText' | 'fontSize' | 'fontWeight'>>) => void
  // 观看/阅读进度（mock：真实实现走 POST /api/progress）
  videoProgress: Record<string, VideoProgress>
  bookProgress: Record<string, BookProgress>
  setVideoProgress: (id: string, v: VideoProgress) => void
  setBookProgress: (id: string, v: BookProgress) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      fontText: '永东国爱 Aa Bb Xx 12345',
      fontSize: 26,
      fontWeight: 400,
      setFontPreview: (p) => set(p),
      videoProgress: { s1: { ep: 3, pos: 754 } },
      setVideoProgress: (id, v) => set((s) => ({ videoProgress: { ...s.videoProgress, [id]: v } })),
      bookProgress: { b2: { pct: 42, chapter: '第二部 · 第 12 章「黑暗森林」', page: 128, total: 302 } },
      setBookProgress: (id, v) => set((s) => ({ bookProgress: { ...s.bookProgress, [id]: v } })),
    }),
    { name: 'portal-prefs' },
  ),
)

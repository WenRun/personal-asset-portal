import { create } from 'zustand'
import type { Album, Track } from '@/types'

interface PlayerState {
  queue: Track[]
  albumId?: string
  albumTitle?: string
  artist?: string
  index: number
  playing: boolean
  pos: number
  volume: number
  playAlbum: (album: Album, startNo?: number) => void
  setPlaying: (v: boolean) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (pct: number) => void
  setVolume: (v: number) => void
  current: () => Track | undefined
}

export const usePlayer = create<PlayerState>()((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  pos: 0,
  volume: 0.7,
  playAlbum(album, startNo = 1) {
    const idx = Math.max(0, album.tracks.findIndex((t) => t.no === startNo))
    set({ queue: album.tracks, albumId: album.id, albumTitle: album.title, artist: album.artist, index: idx, playing: true, pos: 0 })
  },
  setPlaying: (playing) => set({ playing }),
  toggle: () => set((s) => ({ playing: s.queue.length > 0 ? !s.playing : false })),
  next: () =>
    set((s) => (s.queue.length ? { index: (s.index + 1) % s.queue.length, pos: 0 } : {})),
  prev: () =>
    set((s) => {
      if (!s.queue.length) return {}
      if (s.pos > 3) return { pos: 0 }
      return { index: (s.index - 1 + s.queue.length) % s.queue.length, pos: 0 }
    }),
  seek(pct) {
    const cur = get().queue[get().index]
    if (cur) set({ pos: Math.min(cur.durationSec - 1, Math.floor(cur.durationSec * pct)) })
  },
  setVolume: (volume) => set({ volume }),
  current: () => {
    const s = get()
    return s.queue[s.index]
  },
}))

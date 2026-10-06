/**
 * 真实 REST API 层：与 M0 后端（localhost:8000）对接，cookie 会话（credentials: include）。
 * 后端 M0 返回通用资产数据；此处把通用结构映射为各类型视图模型，
 * 领域专属字段（字族/曲目/系列/EXIF…）在 M1–M5 后端解析器就绪后自然填充。
 */

import type {
  Album, Book, Clip, FontFamily, Photo,
} from '@/types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'
export const API_BASE = BASE

// ---------- 基础请求 ----------

export interface RawAsset {
  id: string
  type: 'font' | 'music' | 'video' | 'book' | 'image'
  status: 'pending' | 'parsing' | 'ready' | 'failed'
  title: string
  file_name: string
  size_bytes: number
  mime_type: string | null
  rating: number | null
  is_favorite: boolean
  note: string | null
  created_at: string
  meta?: Record<string, unknown>
  fingerprint?: string
  storage_key?: string
  tags?: { id: string; name: string }[]
  // M1 图片域字段（列表/详情合并返回）
  taken_at?: string | null
  camera?: string | null
  width?: number | null
  height?: number | null
  lens?: string | null
  iso?: number | null
  aperture?: number | null
  shutter?: string | null
  focal_length_mm?: number | null
  gps_lat?: number | null
  gps_long?: number | null
  // M2 字体域字段（列表/详情合并返回）
  family?: string | null
  style?: string | null
  weight?: number | null
  italic?: boolean | null
  is_variable?: boolean | null
  formats?: string[] | null
  glyph_count?: number | null
  languages?: string[] | null
  license?: string | null
  version?: string | null
  designer?: string | null
}

export interface UserPayload { id: string; username: string; role: 'admin' | 'member' }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { message?: string }
      if (j.message) message = j.message
    } catch { /* 非 JSON 错误体 */ }
    const err = new Error(message) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

// ---------- 工具 ----------

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 由 id 派生稳定色相（后端没有颜色字段，用于封面占位） */
export function hueFromId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

const PLAYABLE_EXT = new Set(['mp4', 'webm', 'mov'])
const READABLE_BOOK = new Set(['epub', 'pdf'])

// ---------- 通用 → 视图模型映射 ----------

function base(r: RawAsset) {
  return { hue: hueFromId(r.id), rating: r.rating ?? 0, favorite: r.is_favorite, createdAt: r.created_at }
}

function toFont(r: RawAsset): FontFamily {
  const ext = extOf(r.file_name).toUpperCase()
  return {
    id: r.id,
    family: r.family ?? r.title,
    familyEn: '',
    variable: !!r.is_variable,
    axes: (r.meta?.variable_axes as FontFamily['axes']) ?? [],
    files: [{ styleName: r.style ?? `W${r.weight ?? 400}`, weight: r.weight ?? 400, italic: !!r.italic, format: ext || 'TTF', sizeMB: +(r.size_bytes / 1048576).toFixed(1) }],
    glyphCount: r.glyph_count ?? 0,
    languages: r.languages ?? [],
    license: r.license ?? '',
    version: r.version ?? '',
    designer: r.designer ?? '',
    tags: (r.tags ?? []).map((t) => t.name),
    ...base(r),
    charset: [],
    css: `portal-${r.id}`,
  }
}

function toAlbum(r: RawAsset): Album {
  const ext = extOf(r.file_name)
  const format = (ext === 'flac' ? 'FLAC' : ext === 'mp3' ? 'MP3' : ext.toUpperCase() || 'MP3') as Album['format']
  return {
    id: r.id,
    title: r.title,
    artist: '',
    year: new Date(r.created_at).getFullYear(),
    genre: '',
    format,
    khz: 0,
    bit: 0,
    tracks: [],
    tags: (r.tags ?? []).map((t) => t.name),
    note: r.note ?? '',
    ...base(r),
  }
}

function toClip(r: RawAsset): Clip {
  const ext = extOf(r.file_name)
  return {
    id: r.id,
    kind: 'clip',
    title: r.title,
    durationSec: 0,
    addedAt: r.created_at,
    playable: PLAYABLE_EXT.has(ext),
    resolution: '',
    sizeMB: +(r.size_bytes / 1048576).toFixed(1),
    hue: hueFromId(r.id),
    tags: (r.tags ?? []).map((t) => t.name),
    note: r.note ?? '',
  }
}

function toBook(r: RawAsset): Book {
  const ext = extOf(r.file_name)
  return {
    id: r.id,
    title: r.title,
    author: '',
    publisher: '',
    year: new Date(r.created_at).getFullYear(),
    isbn: '',
    formats: [{ kind: (ext.toUpperCase() || 'EPUB') as Book['formats'][number]['kind'], sizeMB: +(r.size_bytes / 1048576).toFixed(1), readable: READABLE_BOOK.has(ext) }],
    progressPct: 0,
    tags: (r.tags ?? []).map((t) => t.name),
    hue: hueFromId(r.id),
    createdAt: r.created_at,
    desc: r.note ?? '',
    language: '',
    rating: r.rating ?? 0,
  }
}

function toPhoto(r: RawAsset): Photo {
  const w = r.width ?? 0
  const h = r.height ?? 0
  return {
    id: r.id,
    title: r.title,
    fileName: r.file_name,
    takenAt: r.taken_at ?? r.created_at,
    album: '未分组',
    camera: r.camera ?? '',
    lens: r.lens ?? '',
    focal: r.focal_length_mm ? `${r.focal_length_mm}mm` : '',
    aperture: r.aperture ? `f/${r.aperture}` : '',
    shutter: r.shutter ?? '',
    iso: r.iso ?? 0,
    w, h,
    sizeMB: +(r.size_bytes / 1048576).toFixed(1),
    gps: r.gps_lat != null && r.gps_long != null ? `${r.gps_lat}°N, ${r.gps_long}°E` : '',
    hue: hueFromId(r.id),
    // 瀑布流高度：按真实宽高比派生；无 EXIF 尺寸时退回哈希伪随机
    displayH: w > 0 && h > 0 ? Math.min(440, Math.max(120, Math.round((300 * h) / w))) : 170 + (hueFromId(r.id) % 140),
    tags: (r.tags ?? []).map((t) => t.name),
    rating: r.rating ?? 0,
    favorite: r.is_favorite,
  }
}

async function listRaw(route: string): Promise<RawAsset[]> {
  const d = await req<{ items: RawAsset[] }>(`/api/${route}?page_size=200`)
  return d.items
}

async function detailRaw(id: string): Promise<RawAsset> {
  return req<RawAsset>(`/api/assets/${id}`)
}

// ---------- API ----------

export interface StatsPayload {
  counts: { font: number; music: number; video: number; book: number; image: number }
  jobs: { queued: number; running: number; failed: number; done_today: number }
}

export interface JobPayload {
  id: string; kind: string; payload: Record<string, unknown>
  status: 'queued' | 'running' | 'done' | 'failed'
  attempts: number; last_error: string | null
  created_at: string; finished_at: string | null
}

export const api = {
  // 认证
  register: (username: string, password: string) => req<UserPayload>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => req<UserPayload>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => req<UserPayload>('/api/auth/me'),

  // 统计 / 最近
  stats: () => req<StatsPayload>('/api/stats'),
  recent: (limit = 12) => req<RawAsset[]>(`/api/recent?limit=${limit}`),

  // 五类资源
  fonts: async (): Promise<FontFamily[]> => (await listRaw('fonts')).map(toFont),
  font: async (id: string) => toFont(await detailRaw(id)),
  fontCharset: (id: string) => req<{ name: string; pct: number }[]>(`/api/fonts/${id}/charset`),
  fontFileUrl: (id: string) => `${BASE}/api/fonts/${id}/file`,
  fontSpecimenUrl: (id: string) => `${BASE}/api/fonts/${id}/preview/specimen`,
  albums: async (): Promise<Album[]> => (await listRaw('music')).map(toAlbum),
  album: async (id: string) => toAlbum(await detailRaw(id)),
  videos: async (): Promise<Clip[]> => (await listRaw('videos')).map(toClip),
  video: async (id: string) => toClip(await detailRaw(id)),
  books: async (): Promise<Book[]> => (await listRaw('books')).map(toBook),
  book: async (id: string) => toBook(await detailRaw(id)),
  photos: async (): Promise<Photo[]> => (await listRaw('images')).map(toPhoto),
  photo: async (id: string) => toPhoto(await detailRaw(id)),

  // 编辑（admin）
  patchAsset: (id: string, patch: { title?: string; note?: string; rating?: number; is_favorite?: boolean }) =>
    req<RawAsset>(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  downloadUrl: (id: string) => `${BASE}/api/assets/${id}/download`,

  // 标签
  tags: () => req<{ id: string; name: string; count: number }[]>('/api/tags'),
  createTag: (name: string) => req<{ id: string; name: string }>('/api/tags', { method: 'POST', body: JSON.stringify({ name }) }),

  // 搜索（Meilisearch 聚合代理；member）
  search: (q: string, limit = 8) =>
    req<{
      results: { index: string; estimated_total: number; hits: RawAsset[] }[]
    }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // 管理
  jobs: () => req<JobPayload[]>('/api/admin/jobs?limit=100'),
  retryJob: (id: string) => req<{ ok: boolean }>(`/api/admin/jobs/${id}/retry`, { method: 'POST' }),
  settings: () => req<{ scan_roots: { alias: string; path: string }[]; registration_open: boolean }>('/api/admin/settings'),
  updateSettings: (patch: { registration_open?: boolean }) => req<unknown>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  scan: (rootAlias: string) => req<{ job_id: string }>('/api/admin/scan', { method: 'POST', body: JSON.stringify({ root_alias: rootAlias }) }),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<RawAsset>('/api/admin/uploads', { method: 'POST', body: fd })
  },
}

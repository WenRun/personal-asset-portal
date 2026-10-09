import type { RawAsset } from '@/api/client'
import type { AssetType } from '@/types'

export interface Hit {
  to: string
  type: AssetType
  title: string
  sub: string
  hue?: number
  glyph?: string
  coverUrl?: string | null
}

export const GROUP_LABEL: Record<AssetType, string> = {
  font: '字体', music: '音乐', video: '视频', book: '书籍', image: '图片',
}

const ROUTE: Record<AssetType, string> = {
  font: 'fonts', music: 'music', video: 'videos', book: 'books', image: 'images',
}
const GLYPH: Record<AssetType, string> = {
  font: 'A', music: '♪', video: '▶', book: '📖', image: '🖼',
}

export function assetHit(r: RawAsset): Hit {
  const type = r.type
  const ext = r.file_name.includes('.') ? r.file_name.split('.').pop()!.toUpperCase() : ''
  const mb = ((r.size_bytes ?? 0) / 1048576).toFixed(1)
  const subs: Record<AssetType, string> = {
    font: `${ext} · ${mb}MB`,
    music: `${ext} · ${mb}MB`,
    video: `${ext || '视频'} · ${mb}MB`,
    book: `${ext} · ${mb}MB`,
    image: `${r.mime_type ?? ext} · ${mb}MB`,
  }
  return {
    to: `/${ROUTE[type]}/${r.id}`,
    type,
    title: r.title || r.file_name,
    sub: subs[type],
    hue: hueFromId(r.id),
    glyph: GLYPH[type],
    coverUrl: r.cover_url ?? null,
  }
}

// hueFromId 兜底再导出（client 已实现）
import { hueFromId } from '@/api/client'
export { hueFromId }

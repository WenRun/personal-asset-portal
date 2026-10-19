import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Film, Heart, Image as ImageIcon, Music, Type } from 'lucide-react'
import { api, API_BASE, hueFromId } from '@/api/client'
import type { RawAsset } from '@/api/client'
import { BackLink, HueCover, PageHeader } from '@/components/ui'
import { cn, fmtDate, fmtTime } from '@/lib/utils'

/** 收藏分区配置：route 同时是 API 路由与详情页路径前缀 */
const SECTIONS = [
  { type: 'book', label: '书籍', route: 'books', icon: BookOpen },
  { type: 'image', label: '图片', route: 'images', icon: ImageIcon },
  { type: 'video', label: '视频', route: 'videos', icon: Film },
  { type: 'music', label: '音乐', route: 'music', icon: Music },
  { type: 'font', label: '字体', route: 'fonts', icon: Type },
] as const

function coverUrl(r: RawAsset): string | null {
  if (r.type === 'book') return api.bookCoverUrl(r.id, 256)
  if (r.type === 'image') return `${API_BASE}/api/images/${r.id}/thumbnail?size=256`
  if (r.type === 'video' && r.cover_url) return API_BASE + r.cover_url
  return null
}

function subline(r: RawAsset): string {
  switch (r.type) {
    case 'book':
      return [r.authors?.join(' / '), r.publisher].find(Boolean) || '书籍'
    case 'image':
      return [r.width && r.height ? `${r.width}×${r.height}` : '', fmtDate(r.taken_at ?? r.created_at)].filter(Boolean).join(' · ')
    case 'video':
      return [r.kind === 'tutorial' ? '教程' : '素材', r.resolution, r.duration_sec ? fmtTime(r.duration_sec) : ''].filter(Boolean).join(' · ')
    case 'music':
      return [r.format?.toUpperCase(), r.duration_sec ? fmtTime(r.duration_sec) : ''].filter(Boolean).join(' · ')
    case 'font':
      return [r.family, r.style].filter(Boolean).join(' · ')
  }
}

function FavCard({ asset, onRemove }: { asset: RawAsset; onRemove: (id: string) => void }) {
  const nav = useNavigate()
  const [coverFail, setCoverFail] = useState(false)
  const url = coverUrl(asset)
  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-brand-300 hover:shadow-md"
      onClick={() => nav(`/${SECTIONS.find((s) => s.type === asset.type)!.route}/${asset.id}`)}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
        {url && !coverFail ? (
          <img
            src={url}
            alt={asset.title}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
            onError={() => setCoverFail(true)}
          />
        ) : (
          <HueCover hue={hueFromId(asset.id)} className="h-full w-full p-3">
            <span className="line-clamp-3 text-sm font-semibold text-white/90">{asset.type === 'font' ? asset.family || asset.title : asset.title}</span>
          </HueCover>
        )}
        <button
          className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-rose-500 shadow transition hover:bg-white"
          title="取消收藏"
          onClick={(e) => { e.stopPropagation(); onRemove(asset.id) }}
        >
          <Heart className="h-4 w-4" fill="currentColor" />
        </button>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium text-slate-800" title={asset.title}>{asset.title}</div>
        <div className="mt-0.5 truncate text-xs text-slate-400">{subline(asset)}</div>
      </div>
    </div>
  )
}

/** 我的收藏：跨五类资源聚合展示 is_favorite 资产，卡片可跳详情、一键取消收藏 */
export function FavoritesPage() {
  const qc = useQueryClient()
  const books = useQuery({ queryKey: ['favorites', 'books'], queryFn: () => api.assetsByType('books', { favorite: true }) })
  const images = useQuery({ queryKey: ['favorites', 'images'], queryFn: () => api.assetsByType('images', { favorite: true }) })
  const videos = useQuery({ queryKey: ['favorites', 'videos'], queryFn: () => api.assetsByType('videos', { favorite: true }) })
  const music = useQuery({ queryKey: ['favorites', 'music'], queryFn: () => api.assetsByType('music', { favorite: true }) })
  const fonts = useQuery({ queryKey: ['favorites', 'fonts'], queryFn: () => api.assetsByType('fonts', { favorite: true }) })

  const byRoute = { books, images, videos, music, fonts } as const
  const total = SECTIONS.reduce((s, sec) => s + (byRoute[sec.route].data?.length ?? 0), 0)

  const remove = (id: string) => {
    api.patchAsset(id, { is_favorite: false })
      .then(() => qc.invalidateQueries({ queryKey: ['favorites'] }))
      .catch(() => qc.invalidateQueries({ queryKey: ['favorites'] }))
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <BackLink to="/">仪表盘</BackLink>
      <PageHeader title="我的收藏" sub={`共 ${total} 个收藏 · 点击卡片查看详情，心形可取消收藏`} />

      {total === 0 && !SECTIONS.some((s) => byRoute[s.route].isLoading) ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-slate-400">
          <Heart className="h-10 w-10" />
          <div className="text-sm">还没有收藏。去各资源页点击 ♥ 心形按钮，喜欢的内容都会汇集到这里。</div>
        </div>
      ) : (
        <div className="space-y-8">
          {SECTIONS.map((sec) => {
            const items = byRoute[sec.route].data ?? []
            if (items.length === 0) return null
            const Icon = sec.icon
            return (
              <section key={sec.route}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
                  <Icon className="h-4 w-4 text-brand-600" />
                  {sec.label}
                  <span className="font-normal text-slate-400">{items.length}</span>
                </h2>
                <div className={cn('grid gap-4', sec.type === 'image' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
                  {items.map((a) => <FavCard key={a.id} asset={a} onRemove={remove} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

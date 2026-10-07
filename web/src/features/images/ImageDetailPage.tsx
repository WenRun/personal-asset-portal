import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Pencil, Share2 } from 'lucide-react'
import { api, API_BASE } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { BackLink, Badge, Button, HueCover, RatingStars } from '@/components/ui'
import { ShareDialog } from '@/components/ShareDialog'
import { cn } from '@/lib/utils'

export function ImageDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const isAdmin = useAuth((s) => s.user)?.role === 'admin'
  const [shareOpen, setShareOpen] = useState(false)
  const { data: photos } = useQuery({ queryKey: ['photos'], queryFn: () => api.photos() })
  const [rating, setRating] = useState<number | null>(null)
  const [viewerFail, setViewerFail] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const idx = useMemo(() => (photos ?? []).findIndex((p) => p.id === id), [photos, id])
  const photo = photos?.[idx]
  const atFirst = idx === 0
  const atLast = photos != null && idx === photos.length - 1

  // 胶片条：当前缩略图滚动到条中央
  useEffect(() => {
    const strip = stripRef.current
    const cur = strip?.querySelector('[data-current="true"]') as HTMLElement | null
    if (strip && cur) {
      strip.scrollTo({ left: cur.offsetLeft - (strip.clientWidth - cur.clientWidth) / 2, behavior: 'smooth' })
    }
  }, [idx, photo?.id])

  if (!photo || !photos) return <div className="p-6 text-slate-400">加载中…</div>

  return (
    <div className="flex h-full flex-col">
      {/* 查看器顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-4 text-slate-300">
        <BackLink to="/images">图片墙</BackLink>
        <span className="font-mono text-sm text-slate-400">{photo.fileName}</span>
        <Badge className="bg-slate-800 text-slate-400">相册：{photo.album}</Badge>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-lg p-2 hover:bg-slate-800"><Download className="h-4 w-4" /></button>
          {isAdmin && (
            <button className="rounded-lg p-2 hover:bg-slate-800" title="生成公开分享链接" onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" />
            </button>
          )}
          <button className="rounded-lg p-2 hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 查看器 */}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-slate-950">
          {viewerFail ? (
            <HueCover hue={photo.hue} className="absolute inset-6 rounded-lg" />
          ) : (
            <img
              src={`${API_BASE}/api/images/${photo.id}/original`}
              alt={photo.title}
              className="absolute inset-0 h-full w-full object-contain"
              onError={() => setViewerFail(true)}
            />
          )}
          <div className="absolute left-16 top-3 rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-slate-300">
            100% · {photo.w} × {photo.h} · {Math.round((photo.w * photo.h) / 1e6)}MP
          </div>
          <button
            disabled={atFirst}
            className={cn(
              'absolute left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70',
              atFirst && 'cursor-not-allowed opacity-30',
            )}
            onClick={() => !atFirst && nav(`/images/${photos[idx - 1].id}`)}
          ><ChevronLeft className="h-5 w-5" /></button>
          <button
            disabled={atLast}
            className={cn(
              'absolute right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70',
              atLast && 'cursor-not-allowed opacity-30',
            )}
            onClick={() => !atLast && nav(`/images/${photos[idx + 1].id}`)}
          ><ChevronRight className="h-5 w-5" /></button>
          <div
            ref={stripRef}
            className="absolute inset-x-6 bottom-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="mx-auto flex w-fit gap-2">
            {photos.map((p) => (
              <img
                key={p.id}
                data-current={p.id === photo.id}
                src={`${API_BASE}/api/images/${p.id}/thumbnail?size=256`}
                alt={p.title}
                title={p.title}
                onClick={() => p.id !== photo.id && nav(`/images/${p.id}`)}
                className={cn(
                  'h-12 w-20 shrink-0 cursor-pointer rounded object-cover transition',
                  p.id === photo.id
                    ? 'ring-2 ring-brand-400 opacity-100'
                    : 'opacity-50 hover:opacity-90',
                )}
              />
            ))}
            </div>
          </div>
        </div>

        {/* EXIF 侧栏 */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 lg:block">
          <div className="space-y-5">
            <div>
              <div className="font-bold">{photo.title}</div>
              <div className="mt-0.5 text-xs text-slate-400">{(photo.takenAt ?? "").slice(0, 19).replace("T", " ")} 拍摄</div>
              <a href={api.downloadUrl(photo.id)} className="mt-2 block w-full rounded-lg bg-brand-600 py-1.5 text-center text-xs font-medium text-white hover:bg-brand-700">下载原图 {photo.sizeMB}MB</a>
            </div>
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-400">评分</div>
              <RatingStars value={rating ?? photo.rating} onChange={setRating} />
            </section>
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-400">EXIF</div>
              <dl className="divide-y divide-slate-100 text-sm">
                {[
                  ['拍摄时间', (photo.takenAt ?? '').slice(0, 19).replace('T', ' ') || '—'],
                  ['相机', photo.camera || '—'],
                  ['镜头', photo.lens || '—'],
                  ['焦距', photo.focal || '—'],
                  ['光圈', photo.aperture || '—'],
                  ['快门', photo.shutter || '—'],
                  ['ISO', photo.iso ? String(photo.iso) : '—'],
                  ['尺寸', photo.w ? `${photo.w} × ${photo.h}` : '—'],
                  ['文件', `${photo.fileName.split('.').pop()?.toUpperCase()} · ${photo.sizeMB}MB`],
                  ['GPS', photo.gps],
                ].map(([k, v]) => (
                  <div key={k} className="flex py-1.5">
                    <dt className="w-20 shrink-0 text-slate-400">{k}</dt>
                    <dd className="min-w-0 break-all font-mono text-xs leading-5">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-400">标签</div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {photo.tags.map((t) => (
                  <button key={t} className="transition hover:opacity-75" title={`查看「${t}」标签下的图片`} onClick={() => nav(`/images?tag=${encodeURIComponent(t)}`)}>
                    <Badge>{t}</Badge>
                  </button>
                ))}
                <button className="rounded border border-dashed border-slate-300 px-2 py-0.5 text-slate-400 hover:border-brand-400 hover:text-brand-600">+ 添加</button>
              </div>
            </section>
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-400">派生物（可重建）</div>
              <ul className="space-y-1 font-mono text-xs text-slate-400">
                <li>thumb_256.webp ✓</li>
                <li>thumb_1024.webp ✓</li>
                <li>thumb_2560.webp ✓</li>
              </ul>
            </section>
          </div>
        </aside>
      </div>

      {photo && (
        <ShareDialog assetId={photo.id} assetTitle={photo.title} open={shareOpen} onClose={() => setShareOpen(false)} />
      )}
    </div>
  )
}

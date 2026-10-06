import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Pencil, Share2 } from 'lucide-react'
import { api } from '@/api/client'
import { BackLink, Badge, Button, HueCover, RatingStars } from '@/components/ui'
import { cn } from '@/lib/utils'

export function ImageDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: photos } = useQuery({ queryKey: ['photos'], queryFn: api.photos })
  const [rating, setRating] = useState(4)

  const idx = useMemo(() => (photos ?? []).findIndex((p) => p.id === id), [photos, id])
  const photo = photos?.[idx]

  if (!photo || !photos) return <div className="p-6 text-slate-400">加载中…</div>

  const around = [-2, -1, 0, 1, 2].map((d) => photos[(idx + d + photos.length) % photos.length])

  return (
    <div className="flex h-full flex-col">
      {/* 查看器顶栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-4 text-slate-300">
        <BackLink to="/images">图片墙</BackLink>
        <span className="font-mono text-sm text-slate-400">{photo.fileName}</span>
        <Badge className="bg-slate-800 text-slate-400">相册：{photo.album}</Badge>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-lg p-2 hover:bg-slate-800"><Download className="h-4 w-4" /></button>
          <button className="rounded-lg p-2 hover:bg-slate-800"><Share2 className="h-4 w-4" /></button>
          <button className="rounded-lg p-2 hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 查看器 */}
        <div className="relative grid min-w-0 flex-1 place-items-center bg-slate-950">
          <HueCover hue={photo.hue} className="h-[82%] w-[80%] rounded-lg shadow-2xl" />
          <div className="absolute left-3 top-3 rounded bg-black/50 px-2 py-1 font-mono text-[11px] text-slate-300">
            100% · {photo.w} × {photo.h} · {Math.round((photo.w * photo.h) / 1e6)}MP
          </div>
          <button
            className="absolute left-4 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={() => nav(`/images/${photos[(idx - 1 + photos.length) % photos.length].id}`)}
          ><ChevronLeft className="h-5 w-5" /></button>
          <button
            className="absolute right-4 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={() => nav(`/images/${photos[(idx + 1) % photos.length].id}`)}
          ><ChevronRight className="h-5 w-5" /></button>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
            {around.map((p) => (
              <HueCover
                key={p.id}
                hue={p.hue}
                className={cn(
                  'h-10 w-16 cursor-pointer rounded transition',
                  p.id === photo.id ? 'ring-2 ring-brand-400' : 'opacity-60 hover:opacity-100',
                )}
              />
            ))}
          </div>
        </div>

        {/* EXIF 侧栏 */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5 lg:block">
          <div className="space-y-5">
            <div>
              <div className="font-bold">{photo.title}</div>
              <div className="mt-0.5 text-xs text-slate-400">{photo.takenAt.replace('T', ' ')} 拍摄</div>
              <Button size="sm" className="mt-2 w-full">下载原图 {photo.sizeMB}MB</Button>
            </div>
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-400">评分</div>
              <RatingStars value={rating} onChange={setRating} />
            </section>
            <section>
              <div className="mb-1 text-xs font-semibold text-slate-400">EXIF</div>
              <dl className="divide-y divide-slate-100 text-sm">
                {[
                  ['拍摄时间', photo.takenAt.replace('T', ' ')],
                  ['相机', photo.camera],
                  ['镜头', photo.lens],
                  ['焦距', photo.focal],
                  ['光圈', photo.aperture],
                  ['快门', photo.shutter],
                  ['ISO', String(photo.iso)],
                  ['尺寸', `${photo.w} × ${photo.h}`],
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
                {photo.tags.map((t) => <Badge key={t}>{t}</Badge>)}
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
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { api } from '@/api/client'
import { useAssetNav, HueCover, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { Photo } from '@/types'

export function ImagesPage() {
  const { data: photos } = useQuery({ queryKey: ['photos'], queryFn: api.photos })
  const nav = useAssetNav()
  const [filter, setFilter] = useState<string>('all')
  const [favs, setFavs] = useState<Record<string, boolean>>({})

  const months = useMemo(() => [...new Set((photos ?? []).map((p) => p.takenAt.slice(0, 7)))].sort().reverse(), [photos])
  const cameras = useMemo(() => [...new Set((photos ?? []).map((p) => p.camera))], [photos])

  const list = useMemo(() => {
    const arr = photos ?? []
    if (filter === 'all') return arr
    if (filter === 'fav') return arr.filter((p) => favs[p.id] || p.favorite)
    if (cameras.includes(filter)) return arr.filter((p) => p.camera === filter)
    return arr.filter((p) => p.takenAt.startsWith(filter))
  }, [photos, filter, favs, cameras])

  const grouped = useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of list) {
      const k = p.takenAt.slice(0, 7)
      map.set(k, [...(map.get(k) ?? []), p])
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [list])

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="图片"
        sub={`${photos?.length ?? 0} 张（EXIF 解析随 M1 接入，时间线暂用入库时间）`}
        right={<span className="text-xs text-slate-400">游标分页 · 虚拟滚动</span>}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={`rounded-full px-3 py-1.5 text-sm transition ${filter === 'all' ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400'}`} onClick={() => setFilter('all')}>全部</button>
        {months.map((m) => (
          <button key={m} className={`rounded-full px-3 py-1.5 text-sm transition ${filter === m ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400'}`} onClick={() => setFilter(m)}>
            {m.replace('-', '-')} · {(photos ?? []).filter((p) => p.takenAt.startsWith(m)).length}
          </button>
        ))}
        {cameras.map((c) => (
          <button key={c} className={`rounded-full px-3 py-1.5 text-sm transition ${filter === c ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400'}`} onClick={() => setFilter(c)}>
            {c} · {(photos ?? []).filter((p) => p.camera === c).length}
          </button>
        ))}
        <button className={`rounded-full px-3 py-1.5 text-sm transition ${filter === 'fav' ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400'}`} onClick={() => setFilter('fav')}>★ 收藏</button>
      </div>

      {grouped.map(([month, items]) => (
        <div key={month} className="mt-5">
          <div className="mb-3 text-xs font-semibold text-slate-400">{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</div>
          <div className="columns-2 gap-3 md:columns-3 xl:columns-5 [&>*]:mb-3">
            {items.map((p) => (
              <div
                key={p.id}
                className="group relative cursor-pointer overflow-hidden rounded-xl break-inside-avoid"
                onClick={() => nav(`/images/${p.id}`)}
              >
                <HueCover hue={p.hue} className="w-full" >
                  <div style={{ height: p.displayH }} />
                </HueCover>
                <div className="absolute inset-0 bg-slate-900/0 transition group-hover:bg-slate-900/20" />
                <button
                  className={cn('absolute right-2 top-2 rounded-full bg-white/90 p-1 shadow transition', (favs[p.id] || p.favorite) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                  onClick={(e) => { e.stopPropagation(); setFavs({ ...favs, [p.id]: !favs[p.id] }) }}
                >
                  <Heart className={cn('h-4 w-4', (favs[p.id] || p.favorite) ? 'text-rose-500' : 'text-slate-400')} fill={(favs[p.id] || p.favorite) ? 'currentColor' : 'none'} />
                </button>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                  <div className="truncate text-xs text-white">{p.fileName} · {p.sizeMB}MB</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {photos && list.length === 0 && (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">没有符合条件的图片</div>
      )}
      <div className="mt-6 text-center text-xs text-slate-400">滚动加载更多（游标分页）…</div>
    </div>
  )
}

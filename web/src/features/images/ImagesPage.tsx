import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Check, Heart, ListChecks } from 'lucide-react'
import { api, API_BASE } from '@/api/client'
import { useAssetNav, Button, Chip, HueCover, PageHeader } from '@/components/ui'
import { SelectionBar } from '@/components/SelectionBar'
import { useAuth } from '@/stores/auth'
import { useBulkSelect } from '@/lib/useBulkSelect'
import { cn } from '@/lib/utils'
import type { Photo } from '@/types'

export function ImagesPage() {
  const [params, setParams] = useSearchParams()
  const tagFilter = params.get('tag') ?? ''
  const clearTag = () => { const p = new URLSearchParams(params); p.delete('tag'); setParams(p, { replace: true }) }
  // 有 tag 参数时走服务端过滤（不局限在最近 200 条里筛）
  const { data: photos } = useQuery({
    queryKey: ['photos', tagFilter],
    queryFn: () => api.photos(tagFilter ? { tag: tagFilter } : undefined),
  })
  const nav = useAssetNav()
  const user = useAuth((s) => s.user)
  const { selMode, setSelMode, sel, toggleSel, exit } = useBulkSelect()
  const [filter, setFilter] = useState<string>(params.get('favorite') ? 'fav' : 'all')
  const [favs, setFavs] = useState<Record<string, boolean>>({})
  const [imgFail, setImgFail] = useState<Record<string, boolean>>({})

  const months = useMemo(() => [...new Set((photos ?? []).map((p) => p.takenAt.slice(0, 7)))].sort().reverse(), [photos])
  const cameras = useMemo(() => [...new Set((photos ?? []).map((p) => p.camera).filter(Boolean))], [photos])

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
        sub={`${photos?.length ?? 0} 张 · 时间线按拍摄时间分组（无 EXIF 时回退入库时间）`}
        right={
          <>
            {user && (
              <Button size="sm" variant={selMode ? 'primary' : 'outline'} onClick={() => (selMode ? exit() : setSelMode(true))}>
                <ListChecks className="h-3.5 w-3.5" />{selMode ? '退出多选' : '批量选择'}
              </Button>
            )}
            <span className="text-xs text-slate-400">游标分页 · 虚拟滚动</span>
          </>
        }
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={`rounded-full px-3 py-1.5 text-sm transition ${filter === 'all' ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400'}`} onClick={() => setFilter('all')}>全部</button>
        {tagFilter && (
          <button className="rounded-full bg-brand-600 px-3 py-1.5 text-sm text-white transition" onClick={clearTag}>
            标签：{tagFilter} ✕
          </button>
        )}
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
                className={cn(
                  'group relative cursor-pointer overflow-hidden rounded-xl break-inside-avoid',
                  selMode && sel.has(p.id) && 'ring-2 ring-brand-500',
                )}
                onClick={() => (selMode ? toggleSel([p.id]) : nav(`/images/${p.id}`))}
              >
                {selMode && sel.has(p.id) && (
                  <div className="absolute left-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white shadow">
                    <Check className="h-3.5 w-3.5" />
                  </div>
                )}
                {imgFail[p.id] ? (
                  <HueCover hue={p.hue} className="w-full"><div style={{ height: p.displayH }} /></HueCover>
                ) : (
                  <img
                    src={`${API_BASE}/api/images/${p.id}/thumbnail?size=256`}
                    loading="lazy"
                    alt={p.title}
                    className="w-full bg-slate-200 object-cover transition group-hover:brightness-95"
                    style={{ height: p.displayH }}
                    onError={() => setImgFail((f) => ({ ...f, [p.id]: true }))}
                  />
                )}
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

      {user && selMode && <SelectionBar ids={[...sel]} onDone={exit} onCancel={exit} />}
    </div>
  )
}

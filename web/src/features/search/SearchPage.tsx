import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { GROUP_LABEL, assetHit } from '@/lib/search'
import { HueCover, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { AssetType } from '@/types'

const ORDER: AssetType[] = ['font', 'music', 'video', 'book', 'image']
const GROUP_KEY: Record<AssetType, string> = { font: 'fonts', music: 'music', video: 'videos', book: 'books', image: 'images' }

/** /search?q=&tag= 完整结果页（Cmd+K 只展示每类 Top5，这里展示全部命中，上限 50） */
export function SearchPage() {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [tag, setTag] = useState(params.get('tag') ?? '')
  const nav = useNavigate()
  const { data } = useQuery({ queryKey: ['search', q, tag], queryFn: () => api.search(q, 50, tag || undefined) })

  const byIndex = new Map((data?.results ?? []).map((r) => [r.index, r]))
  const groups = ORDER.map((t) => ({
    type: t,
    list: (byIndex.get(GROUP_KEY[t])?.hits ?? []).map(assetHit),
  })).filter((g) => g.list.length > 0)
  const total = (data?.results ?? []).reduce((s, r) => s + r.estimated_total, 0)

  // 跨索引聚合 tags facet（标签进索引后由 Meili 返回分布）
  const tagFacets = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data?.results ?? []) {
      for (const [t, n] of Object.entries(r.facet_distribution?.tags ?? {})) {
        m.set(t, (m.get(t) ?? 0) + n)
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
  }, [data])

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="全局搜索" sub={q ? `「${q}」约 ${total} 项命中` : '输入关键词搜索全部五类资源（Meilisearch 聚合）'} />
      <div className="mt-4">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索字体、音乐、视频、书籍、图片…"
          className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {tagFacets.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">按标签筛选</span>
          {tagFacets.map(([t, n]) => (
            <button
              key={t}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition',
                t === tag ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-400',
              )}
              onClick={() => setTag(t === tag ? '' : t)}
            >
              {t} · {n}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 max-w-3xl space-y-6">
        {groups.map(({ type, list }) => (
          <div key={type}>
            <div className="mb-2 text-[10px] font-semibold text-slate-400">{GROUP_LABEL[type]} · {list.length}</div>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
              {list.map((hit) => (
                <div
                  key={hit.to}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50"
                  onClick={() => nav(hit.to)}
                >
                  <HueCover hue={hit.hue ?? 245} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white">
                    <span className="text-sm">{hit.glyph ?? '·'}</span>
                  </HueCover>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{hit.title}</div>
                    <div className="truncate text-xs text-slate-400">{hit.sub}</div>
                  </div>
                  <span className="ml-auto text-[10px] text-slate-300">{GROUP_LABEL[hit.type]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            {q ? `没有匹配「${q}」的资源` : '试试搜索已入库的文件名关键词'}
          </div>
        )}
      </div>
    </div>
  )
}

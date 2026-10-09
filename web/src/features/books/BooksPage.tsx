import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { api, API_BASE } from '@/api/client'
import { useAssetNav, Badge, Button, Chip, HueCover, PageHeader } from '@/components/ui'
import { SelectionBar } from '@/components/SelectionBar'
import { useAuth } from '@/stores/auth'
import { useBulkSelect } from '@/lib/useBulkSelect'
import { cn } from '@/lib/utils'

function BookCover({ id, hue, title, className }: { id?: string; hue: number; title: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (id && !failed) {
    return (
      <img
        src={api.bookCoverUrl(id, 256)}
        alt={title}
        className={`w-full rounded-lg bg-slate-200 object-cover ${className ?? ''}`}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <HueCover hue={hue} dir={160} className={`p-2.5 flex flex-col justify-end ${className ?? ''}`}>
      <span className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
      <div className="relative text-[13px] font-semibold leading-tight text-white">{title}</div>
    </HueCover>
  )
}

export function BooksPage() {
  const [params, setParams] = useSearchParams()
  const tagFilter = params.get('tag') ?? ''
  const clearTag = () => { const p = new URLSearchParams(params); p.delete('tag'); setParams(p, { replace: true }) }
  const { data: books } = useQuery({
    queryKey: ['books', tagFilter],
    queryFn: () => api.books(tagFilter ? { tag: tagFilter } : undefined),
  })
  const nav = useAssetNav()
  const user = useAuth((s) => s.user)
  const { selMode, setSelMode, sel, toggleSel, exit } = useBulkSelect()
  const [filter, setFilter] = useState<'all' | 'reading' | 'unread' | 'readable' | 'fav'>(params.get('favorite') ? 'fav' : 'all')
  const [coverFail, setCoverFail] = useState<Record<string, boolean>>({})
  const cardClick = (id: string) => (selMode ? toggleSel([id]) : nav(`/books/${id}`))

  const list = useMemo(() => {
    const arr = books ?? []
    if (filter === 'reading') return arr.filter((b) => b.progressPct > 0 && b.progressPct < 100)
    if (filter === 'unread') return arr.filter((b) => b.progressPct === 0)
    if (filter === 'readable') return arr.filter((b) => b.formats.some((f) => f.readable))
    if (filter === 'fav') return arr.filter((b) => b.rating >= 5)
    return arr
  }, [books, filter])

  const seriesList = useMemo(() => {
    const groups = new Map<string, typeof list>()
    for (const b of list) if (b.series) groups.set(b.series.name, [...(groups.get(b.series.name) ?? []), b])
    return [...groups.entries()].filter(([, bs]) => bs.length > 1)
  }, [list])
  const inSeries = new Set(seriesList.flatMap(([, bs]) => bs.map((b) => b.id)))
  const standalone = list.filter((b) => !inSeries.has(b.id))

  const fmtState = (b: Book2) =>
    b.progressPct === 100 ? <span className="text-[10px] text-emerald-600">已读</span>
      : b.progressPct > 0 ? <span className="text-[10px] text-brand-600">在读 {b.progressPct}%</span>
        : <span className="text-[10px] text-slate-400">未读</span>
  type Book2 = NonNullable<typeof books>[number]

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="书籍"
        sub={`${books?.length ?? 0} 本（支持 EPUB / PDF / MOBI / AZW3 / TXT 在线阅读与章节翻页）`}
        right={user && (
          <Button size="sm" variant={selMode ? 'primary' : 'outline'} onClick={() => (selMode ? exit() : setSelMode(true))}>
            <ListChecks className="h-3.5 w-3.5" />{selMode ? '退出多选' : '批量选择'}
          </Button>
        )}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        {tagFilter && <Chip active onClick={clearTag}>标签：{tagFilter} ✕</Chip>}
        <Chip active={filter === 'reading'} onClick={() => setFilter('reading')}>在读</Chip>
        <Chip active={filter === 'unread'} onClick={() => setFilter('unread')}>未读</Chip>
        <Chip active={filter === 'readable'} onClick={() => setFilter('readable')}>可在线阅读</Chip>
        <Chip active={filter === 'fav'} onClick={() => setFilter('fav')}>★ 收藏</Chip>
      </div>

      {seriesList.map(([name, bs]) => (
        <div key={name} className="mt-6">
          <div className="mb-3 text-xs font-semibold text-slate-400">
            系列 · {name}（{bs.length} 本）
          </div>
          <div className="grid grid-cols-3 gap-4 md:grid-cols-6 xl:grid-cols-8">
            {bs.sort((a, b) => (a.series?.idx ?? 0) - (b.series?.idx ?? 0)).map((b) => (
              <div
                key={b.id}
                className={cn('group cursor-pointer rounded-lg', selMode && sel.has(b.id) && 'ring-2 ring-brand-500')}
                onClick={() => cardClick(b.id)}
              >
                <BookCover id={b.id} hue={b.hue} title={b.title} className="aspect-[3/4] shadow-sm transition group-hover:shadow-md" />
                <div className="mt-1.5 truncate text-xs font-medium">{b.title}</div>
                {fmtState(b)}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-6 text-xs font-semibold text-slate-400">最近入库</div>
      <div className="mt-3 grid grid-cols-3 gap-4 md:grid-cols-6 xl:grid-cols-8">
        {standalone.map((b) => {
          const onlyDownload = !b.formats.some((f) => f.readable)
          return (
            <div
              key={b.id}
              className={cn('group cursor-pointer rounded-lg', selMode && sel.has(b.id) && 'ring-2 ring-brand-500')}
              onClick={() => cardClick(b.id)}
            >
              <div className="relative">
                <BookCover id={b.id} hue={b.hue} title={b.title} className="aspect-[3/4] shadow-sm transition group-hover:shadow-md" />
                <span className="absolute right-2 top-2 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white">{b.formats[0].kind}</span>
              </div>
              <div className="mt-1.5 truncate text-xs font-medium">{b.title}</div>
              <div className="truncate text-[10px] text-slate-400">
                {onlyDownload
                  ? <span className="text-amber-600">{b.formats[0].kind} · 仅下载</span>
                  : <>{b.author && `${b.author} · `}{fmtState(b)}</>}
              </div>
            </div>
          )
        })}
      </div>

      {user && selMode && <SelectionBar ids={[...sel]} onDone={exit} onCancel={exit} />}
    </div>
  )
}

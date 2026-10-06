import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { useAssetNav, Badge, Chip, HueCover, PageHeader } from '@/components/ui'

export function FontsPage() {
  const { data: fonts } = useQuery({ queryKey: ['fonts'], queryFn: api.fonts })
  const nav = useAssetNav()
  const { fontText, fontSize, fontWeight, setFontPreview } = usePrefs()
  const [filter, setFilter] = useState<'all' | 'otf' | 'ttf' | 'fav'>('all')

  const list = useMemo(() => {
    const arr = fonts ?? []
    if (filter === 'otf') return arr.filter((f) => f.files[0].format === 'OTF')
    if (filter === 'ttf') return arr.filter((f) => f.files[0].format === 'TTF')
    if (filter === 'fav') return arr.filter((f) => f.favorite)
    return arr
  }, [fonts, filter])

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="字体" sub={`${fonts?.length ?? 0} 个字体文件（M0 通用元数据 · 字族/字重解析随 M2 接入）`} />

      {/* 全局预览文案控制条（prefsStore 共享，详情页样张同步） */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm md:flex-nowrap">
        <span className="shrink-0 text-xs text-slate-400">预览文案</span>
        <input
          value={fontText}
          onChange={(e) => setFontPreview({ fontText: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-serif text-lg outline-none"
        />
        <span className="shrink-0 text-xs text-slate-400">字号</span>
        <input type="range" min={16} max={44} value={fontSize} onChange={(e) => setFontPreview({ fontSize: Number(e.target.value) })} className="w-24 accent-brand-600" />
        <span className="shrink-0 text-xs text-slate-400">字重</span>
        <input type="range" min={100} max={900} step={100} value={fontWeight} onChange={(e) => setFontPreview({ fontWeight: Number(e.target.value) })} className="w-20 accent-brand-600" />
        <span className="shrink-0 font-mono text-xs text-slate-400">{fontWeight}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        <Chip active={filter === 'otf'} onClick={() => setFilter('otf')}>OTF</Chip>
        <Chip active={filter === 'ttf'} onClick={() => setFilter('ttf')}>TTF</Chip>
        <Chip active={filter === 'fav'} onClick={() => setFilter('fav')}>★ 收藏</Chip>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((f) => (
          <div
            key={f.id}
            onClick={() => nav(`/fonts/${f.id}`)}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-md"
          >
            <div className="mb-3 flex items-start justify-between">
              <div className="font-semibold">{f.family} <span className="text-xs font-normal text-slate-400">{f.familyEn}</span></div>
              {f.variable && <Badge tone="violet">可变</Badge>}
            </div>
            <div
              className="mb-3 leading-snug"
              style={{ fontFamily: f.css, fontSize, fontWeight: Math.min(900, fontWeight) }}
            >
              {fontText}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge>{f.files.length} 字重</Badge>
              <Badge>{f.files[0].format}</Badge>
              {f.languages.map((l) => <Badge key={l}>{l}</Badge>)}
              {f.license === 'SIL OFL 1.1' && <Badge tone="amber">OFL</Badge>}
            </div>
          </div>
        ))}
        {fonts && list.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">没有符合条件的字体</div>
        )}
      </div>
    </div>
  )
}

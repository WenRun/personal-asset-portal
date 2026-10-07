import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { useFontFace } from '@/lib/useFontFace'
import { useAssetNav, Badge, Chip, PageHeader } from '@/components/ui'
import type { FontFamily } from '@/types'

/** 字族卡片：FontFace 真实加载，失败回落服务端样张图（§5.1） */
function FamilyCard({ family, files, text, size, weight }: {
  family: string
  files: FontFamily[]
  text: string
  size: number
  weight: number
}) {
  const nav = useAssetNav()
  const primary = files[0]
  const { family: cssFamily, state } = useFontFace(primary.id, api.fontFileUrl(primary.id))

  return (
    <div
      onClick={() => nav(`/fonts/${primary.id}`)}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="font-semibold">{family}</div>
        <div className="flex gap-1">
          {files.some((f) => f.variable) && <Badge tone="violet">可变</Badge>}
        </div>
      </div>
      {state === 'error' ? (
        <img src={api.fontSpecimenUrl(primary.id)} alt={family} className="mb-3 w-full rounded-lg" />
      ) : (
        <div
          className="mb-3 leading-snug"
          style={{ fontFamily: state === 'ready' ? cssFamily : undefined, fontSize: size, fontWeight: weight }}
        >
          {text}
          {state === 'loading' && <span className="ml-2 align-middle text-xs text-slate-300">字体加载中…</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Badge>{files.length} 字重</Badge>
        <Badge>{primary.files[0].format}</Badge>
        {primary.languages.map((l) => <Badge key={l}>{l}</Badge>)}
        {primary.license === 'SIL OFL 1.1' && <Badge tone="amber">OFL</Badge>}
      </div>
    </div>
  )
}

export function FontsPage() {
  const [params, setParams] = useSearchParams()
  const tagFilter = params.get('tag') ?? ''
  const clearTag = () => { const p = new URLSearchParams(params); p.delete('tag'); setParams(p, { replace: true }) }
  const { data: fonts } = useQuery({
    queryKey: ['fonts', tagFilter],
    queryFn: () => api.fonts(tagFilter ? { tag: tagFilter } : undefined),
  })
  const { fontText, fontSize, fontWeight, setFontPreview } = usePrefs()
  const [filter, setFilter] = useState<'all' | 'han' | 'variable' | 'fav'>(params.get('favorite') ? 'fav' : 'all')

  const list = useMemo(() => {
    const arr = fonts ?? []
    if (filter === 'han') return arr.filter((f) => f.languages.some((l) => l.includes('中文')))
    if (filter === 'variable') return arr.filter((f) => f.variable)
    if (filter === 'fav') return arr.filter((f) => f.favorite)
    return arr
  }, [fonts, filter])

  // 字族聚合（§5.1）：同 family 多字重文件归为一个展示单元
  const families = useMemo(() => {
    const m = new Map<string, FontFamily[]>()
    for (const f of list) {
      const key = f.family
      m.set(key, [...(m.get(key) ?? []), f])
    }
    return [...m.entries()]
      .map(([family, files]) => ({ family, files: files.sort((a, b) => a.files[0].weight - b.files[0].weight) }))
      .sort((a, b) => a.family.localeCompare(b.family, 'zh-Hans-CN'))
  }, [list])

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="字体"
        sub={`${families.length} 个字族 · ${fonts?.length ?? 0} 个文件（fontTools 解析）`}
      />

      {/* 全局预览文案控制条（prefsStore 共享，详情页样张同步） */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm md:flex-nowrap">
        <span className="shrink-0 text-xs text-slate-400">预览文案</span>
        <input
          value={fontText}
          onChange={(e) => setFontPreview({ fontText: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-lg outline-none"
        />
        <span className="shrink-0 text-xs text-slate-400">字号</span>
        <input type="range" min={16} max={44} value={fontSize} onChange={(e) => setFontPreview({ fontSize: Number(e.target.value) })} className="w-24 accent-brand-600" />
        <span className="shrink-0 text-xs text-slate-400">字重</span>
        <input type="range" min={100} max={900} step={100} value={fontWeight} onChange={(e) => setFontPreview({ fontWeight: Number(e.target.value) })} className="w-20 accent-brand-600" />
        <span className="shrink-0 font-mono text-xs text-slate-400">{fontWeight}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        {tagFilter && <Chip active onClick={clearTag}>标签：{tagFilter} ✕</Chip>}
        <Chip active={filter === 'han'} onClick={() => setFilter('han')}>含中文</Chip>
        <Chip active={filter === 'variable'} onClick={() => setFilter('variable')}>可变字体</Chip>
        <Chip active={filter === 'fav'} onClick={() => setFilter('fav')}>★ 收藏</Chip>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {families.map(({ family, files }) => (
          <FamilyCard key={family} family={family} files={files} text={fontText} size={fontSize} weight={fontWeight} />
        ))}
        {fonts && families.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">没有符合条件的字体</div>
        )}
      </div>
      <div className="mt-4 text-center text-xs text-slate-400">
        样张为真实字体渲染（FontFace 加载 /api/fonts/&#123;id&#125;/file，失败回落服务端样张图）；字族打包下载随 M6 上线
      </div>
    </div>
  )
}

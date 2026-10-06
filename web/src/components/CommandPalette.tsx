import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUI } from '@/stores/ui'
import { api } from '@/api/client'
import { GROUP_LABEL, assetHit, type Hit } from '@/lib/search'
import { HueCover } from '@/components/ui'
import type { AssetType } from '@/types'

const TYPE_ORDER: AssetType[] = ['font', 'music', 'video', 'book', 'image']
const GROUP_KEY: Record<AssetType, string> = { font: 'fonts', music: 'music', video: 'videos', book: 'books', image: 'images' }

/** Cmd+K 全局搜索（§7.4）：150ms 防抖 → /api/search 聚合 → 键盘导航 */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const setPalette = useUI((s) => s.setPalette)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sel, setSel] = useState(0)
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150)
    return () => clearTimeout(t)
  }, [q])

  const { data } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced, 5),
    enabled: open,
  })

  const flat = useMemo<Hit[]>(() => {
    const byIndex = new Map((data?.results ?? []).map((r) => [r.index, r]))
    return TYPE_ORDER.flatMap((t) =>
      (byIndex.get(GROUP_KEY[t])?.hits ?? []).map(assetHit),
    )
  }, [data])

  useEffect(() => setSel(0), [debounced])
  useEffect(() => {
    if (open) {
      setQ('')
      setDebounced('')
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  if (!open) return null

  const go = (hit?: Hit) => {
    if (!hit) return
    setPalette(false)
    nav(hit.to)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[sel]) }
  }

  let idx = -1
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setPalette(false)}>
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-5">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="搜索字体、音乐、视频、书籍、图片…"
            className="flex-1 text-lg outline-none placeholder:text-slate-300"
          />
          <span className="text-[10px] text-slate-400">Meilisearch</span>
          <kbd className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2 text-sm" onKeyDown={onKey}>
          {flat.length === 0 && (
            <div className="py-10 text-center text-slate-400">{debounced ? `没有匹配「${debounced}」的资源` : '输入关键词，或回车浏览最近资源'}</div>
          )}
          {TYPE_ORDER.map((t) => {
            const byIndex = new Map((data?.results ?? []).map((r) => [r.index, r]))
            const list = (byIndex.get(GROUP_KEY[t])?.hits ?? []).map(assetHit)
            if (list.length === 0) return null
            return (
              <div key={t}>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold text-slate-400">
                  {GROUP_LABEL[t]} · {list.length}
                </div>
                {list.map((hit) => {
                  idx += 1
                  const active = idx === sel
                  return (
                    <div
                      key={hit.to}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                      onMouseEnter={() => setSel(flat.findIndex((x) => x.to === hit.to))}
                      onClick={() => go(hit)}
                    >
                      <HueCover hue={hit.hue ?? 245} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white">
                        <span className="text-sm">{hit.glyph ?? '·'}</span>
                      </HueCover>
                      <div className="min-w-0">
                        <div className="truncate">{hit.title}</div>
                        <div className="truncate text-xs text-slate-400">{hit.sub}</div>
                      </div>
                      <span className="ml-auto text-[10px] text-slate-300">{GROUP_LABEL[hit.type]}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-5 py-2.5 text-[10px] text-slate-400">
          <span><kbd className="rounded border px-1">↑↓</kbd> 导航</span>
          <span><kbd className="rounded border px-1">↵</kbd> 打开</span>
          <span
            className="ml-auto cursor-pointer hover:text-brand-600"
            onClick={() => { setPalette(false); nav(`/search?q=${encodeURIComponent(debounced)}`) }}
          >
            在搜索页查看全部 →
          </span>
        </div>
      </div>
    </div>
  )
}

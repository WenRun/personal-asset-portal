import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { useFontFace } from '@/lib/useFontFace'
import { BackLink, Badge, Button } from '@/components/ui'

/** 字体详情（§5.1）：同字族字重列表 + FontFace 实时样张 + 可变轴 + 字符集覆盖率 */
export function FontDetailPage() {
  const { id } = useParams()
  const { data: font } = useQuery({ queryKey: ['font', id], queryFn: () => api.font(id!), enabled: !!id })
  const { data: allFonts } = useQuery({ queryKey: ['fonts'], queryFn: api.fonts })
  const { data: charset } = useQuery({
    queryKey: ['font-charset', id],
    queryFn: () => api.fontCharset(id!),
    enabled: !!id,
  })
  const { fontText, fontSize, setFontPreview } = usePrefs()

  const [fav, setFav] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wght, setWght] = useState<number | null>(null)

  // 同字族文件（字族聚合视图）
  const siblings = useMemo(() => {
    if (!font || !allFonts) return null
    return allFonts
      .filter((f) => f.family === font.family)
      .sort((a, b) => a.files[0].weight - b.files[0].weight)
  }, [font, allFonts])

  const currentId = selectedId ?? id ?? ''
  const current = siblings?.find((f) => f.id === currentId) ?? font
  const currentWeight = wght ?? current?.files[0].weight ?? 400
  const axes = current?.axes ?? []
  const wghtAxis = axes.find((a) => a.tag === 'wght')

  // 当前选中字重的 FontFace 真实加载
  const { family: cssFamily, state: faceState } = useFontFace(currentId, api.fontFileUrl(currentId), !!currentId)

  useEffect(() => { setSelectedId(null); setWght(null) }, [id])

  if (!font) return <div className="p-6 text-slate-400">加载中…</div>

  const italic = current?.files[0].italic ?? false

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <BackLink to="/fonts">字体墙</BackLink>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">预览文案</span>
            <input
              value={fontText}
              onChange={(e) => setFontPreview({ fontText: e.target.value })}
              className="w-56 rounded-lg border border-slate-200 px-2 py-1 outline-none focus:border-brand-500"
            />
            <span className="text-slate-400">全局字号</span>
            <input type="range" min={16} max={44} value={fontSize} onChange={(e) => setFontPreview({ fontSize: Number(e.target.value) })} className="w-20 accent-brand-600" />
            {faceState === 'loading' && <span className="text-slate-300">字体加载中…</span>}
            {faceState === 'error' && (
              <img src={api.fontSpecimenUrl(font.id)} alt={font.family} className="h-10 rounded" />
            )}
          </div>
          <div className="space-y-4" style={{ fontFamily: faceState === 'ready' ? cssFamily : undefined }}>
            <div style={{ fontSize: fontSize + 4, fontWeight: currentWeight, fontStyle: italic ? 'italic' : 'normal' }}>{fontText}</div>
            <div style={{ fontSize: 22, fontWeight: currentWeight }} className="text-slate-700">{fontText}</div>
            <div style={{ fontSize: 18, fontWeight: currentWeight }} className="text-slate-500">{fontText}</div>
            <div style={{ fontSize: 15, fontWeight: currentWeight }} className="text-slate-400">{fontText}</div>
          </div>
        </div>

        {/* 同字族字重文件（真实聚合） */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 text-xs font-semibold text-slate-400">
            字重文件（{siblings?.length ?? 1}）· 点击切换样张
          </div>
          <div className="divide-y divide-slate-100 text-sm">
            {(siblings ?? [font]).map((f) => {
              const active = f.id === currentId
              return (
                <button
                  key={f.id}
                  className="flex w-full items-center justify-between px-2 py-2.5 text-left transition hover:bg-slate-50"
                  onClick={() => { setSelectedId(f.id); setWght(null) }}
                >
                  <span style={{ fontWeight: Math.min(900, f.files[0].weight), fontStyle: f.files[0].italic ? 'italic' : 'normal' }}>
                    {f.files[0].styleName || `W${f.files[0].weight}`}
                    {active && <span className="ml-2 text-xs text-brand-600">当前</span>}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">{f.files[0].format} · {f.files[0].sizeMB}MB</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <aside className="hidden w-96 shrink-0 overflow-y-auto border-l border-slate-200 bg-white lg:block">
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-bold">{font.family} {font.familyEn && <span className="text-sm font-normal text-slate-400">{font.familyEn}</span>}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                字族 · {siblings?.length ?? 1} 个字重文件 · {((siblings ?? [font]).reduce((s, f) => s + f.files[0].sizeMB, 0)).toFixed(1)}MB
              </div>
            </div>
            <button className={fav ?? font.favorite ? 'text-rose-500' : 'text-slate-300 hover:text-rose-400'} onClick={() => setFav(!(fav ?? font.favorite))}>
              <Heart className="h-5 w-5" fill={(fav ?? font.favorite) ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" title="字族打包下载随 M6 上线">下载字族 (.zip)</Button>
            <Button variant="outline">编辑</Button>
          </div>

          {axes.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-400">可变字体轴</div>
              <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">
                {axes.map((a) => (
                  <div key={a.tag} className="flex items-center gap-3">
                    <span className="w-12 font-mono text-xs text-slate-500">{a.tag}</span>
                    <input
                      type="range" min={a.min} max={a.max} value={wghtAxis && a.tag === 'wght' ? (wght ?? a.def) : a.def}
                      onChange={(e) => a.tag === 'wght' && setWght(Number(e.target.value))}
                      className="flex-1 accent-brand-600"
                    />
                    <span className="w-10 text-right font-mono text-xs">{a.tag === 'wght' && wght != null ? wght : a.def}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {charset && charset.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-400">字符集覆盖（cmap 实测）</div>
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                {charset.map((c) => (
                  <div key={c.name}>
                    <div className="mb-1 flex justify-between text-sm"><span>{c.name}</span><span className="font-mono text-xs text-slate-400">{c.pct}%</span></div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div className={c.pct > 50 ? 'h-1.5 rounded-full bg-emerald-500' : 'h-1.5 rounded-full bg-slate-300'} style={{ width: `${Math.max(c.pct, 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 text-xs font-semibold text-slate-400">元数据</div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">字重</dt><dd className="font-mono">{currentWeight}</dd></div>
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">字形数</dt><dd className="font-mono">{font.glyphCount.toLocaleString()}</dd></div>
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">版本</dt><dd>{font.version || '—'}</dd></div>
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">设计者</dt><dd>{font.designer || '—'}</dd></div>
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">许可</dt><dd>{font.license ? <span className="line-clamp-2 text-xs text-slate-500">{font.license}</span> : '—'}</dd></div>
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">语言</dt><dd className="flex flex-wrap gap-1.5">{font.languages.map((l) => <Badge key={l}>{l}</Badge>)}</dd></div>
              <div className="flex py-2"><dt className="w-20 shrink-0 text-slate-400">标签</dt><dd className="flex flex-wrap gap-1.5">{font.tags.map((t) => <Badge key={t}>{t}</Badge>)}<button className="text-xs text-slate-400 hover:text-brand-600">+ 添加</button></dd></div>
            </dl>
          </section>

          <section>
            <div className="mb-2 text-xs font-semibold text-slate-400">派生物（可重建）</div>
            <ul className="space-y-1 font-mono text-xs text-slate-400">
              <li>specimen.png ✓</li>
              <li>charset.json ✓</li>
            </ul>
          </section>
        </div>
      </aside>
    </div>
  )
}

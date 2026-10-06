import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { BackLink, Badge, Button, HueCover } from '@/components/ui'

export function FontDetailPage() {
  const { id } = useParams()
  const { data: font } = useQuery({ queryKey: ['font', id], queryFn: () => api.font(id!), enabled: !!id })
  const { fontText, fontSize, setFontPreview } = usePrefs()
  const [axes, setAxes] = useState<Record<string, number>>({})
  const [fav, setFav] = useState(font?.favorite ?? false)

  if (!font) return <div className="p-6 text-slate-400">加载中…</div>

  const axisVal = (tag: string, def: number) => axes[tag] ?? def
  const wght = axisVal('wght', 400)

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
          </div>
          <div className="space-y-4" style={{ fontFamily: font.css }}>
            <div style={{ fontSize: fontSize + 4, fontWeight: wght }}>{fontText}</div>
            <div style={{ fontSize: 22, fontWeight: wght }} className="text-slate-700">{fontText}</div>
            <div style={{ fontSize: 18, fontWeight: wght }} className="text-slate-500">{fontText}</div>
            <div style={{ fontSize: 15, fontWeight: wght }} className="text-slate-400">{fontText}</div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 text-xs font-semibold text-slate-400">字重文件（{font.files.length}）</div>
          <div className="divide-y divide-slate-100 text-sm">
            {font.files.map((file) => (
              <button
                key={file.styleName}
                className="flex w-full items-center justify-between px-2 py-2.5 text-left transition hover:bg-slate-50"
                onClick={() => setFontPreview({ fontWeight: file.weight })}
              >
                <span style={{ fontFamily: font.css, fontWeight: Math.min(900, file.weight), fontStyle: file.italic ? 'italic' : 'normal' }}>
                  {file.styleName}
                </span>
                <span className="text-xs text-slate-400 font-mono">{file.format} · {file.sizeMB}MB</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <aside className="hidden w-96 shrink-0 overflow-y-auto border-l border-slate-200 bg-white lg:block">
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-bold">{font.family} <span className="text-sm font-normal text-slate-400">{font.familyEn}</span></div>
              <div className="mt-0.5 text-xs text-slate-400">字族 · {font.files.length} 个字重文件 · {font.files.reduce((s, f) => s + f.sizeMB, 0).toFixed(1)}MB</div>
            </div>
            <button className={fav ? 'text-rose-500' : 'text-slate-300 hover:text-rose-400'} onClick={() => setFav(!fav)}>
              <Heart className="h-5 w-5" fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1">下载字族 (.zip)</Button>
            <Button variant="outline">编辑</Button>
          </div>

          {font.axes.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-400">可变字体轴</div>
              <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">
                {font.axes.map((a) => (
                  <div key={a.tag} className="flex items-center gap-3">
                    <span className="w-12 font-mono text-xs text-slate-500">{a.tag}</span>
                    <input
                      type="range" min={a.min} max={a.max} value={axisVal(a.tag, a.def)}
                      onChange={(e) => setAxes({ ...axes, [a.tag]: Number(e.target.value) })}
                      className="flex-1 accent-brand-600"
                    />
                    <span className="w-10 text-right font-mono text-xs">{axisVal(a.tag, a.def)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 text-xs font-semibold text-slate-400">字符集覆盖</div>
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              {font.charset.map((c) => (
                <div key={c.name}>
                  <div className="mb-1 flex justify-between text-sm"><span>{c.name}</span><span className="font-mono text-xs text-slate-400">{c.pct}%</span></div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className={c.pct > 50 ? 'h-1.5 rounded-full bg-emerald-500' : 'h-1.5 rounded-full bg-slate-300'} style={{ width: `${Math.max(c.pct, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-xs font-semibold text-slate-400">元数据</div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex py-2"><dt className="w-20 text-slate-400">版本</dt><dd>{font.version}</dd></div>
              <div className="flex py-2"><dt className="w-20 text-slate-400">设计者</dt><dd>{font.designer}</dd></div>
              <div className="flex py-2"><dt className="w-20 text-slate-400">许可</dt><dd><Badge tone={font.license === 'SIL OFL 1.1' ? 'amber' : 'red'}>{font.license}</Badge></dd></div>
              <div className="flex py-2"><dt className="w-20 text-slate-400">字形数</dt><dd className="font-mono">{font.glyphCount.toLocaleString()}</dd></div>
              <div className="flex py-2"><dt className="w-20 text-slate-400">标签</dt><dd className="flex flex-wrap gap-1.5">{font.tags.map((t) => <Badge key={t}>{t}</Badge>)}</dd></div>
            </dl>
          </section>

          <section>
            <div className="mb-2 text-xs font-semibold text-slate-400">派生物（可重建）</div>
            <ul className="space-y-1 font-mono text-xs text-slate-400">
              <li>specimen.png ✓</li>
              <li>charset.json ✓</li>
            </ul>
          </section>

          <HueCover hue={245} className="hidden h-16 rounded-xl opacity-40" />
        </div>
      </aside>
    </div>
  )
}

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, X } from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { BackLink, Badge, Button, HueCover, Modal, RatingStars } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

const READER_PARAGRAPHS = [
  '这次突然的陨石雨，把第一次联合国会议变成了一个紧急会议。人类对三体世界的任何计划在末日之战面前都显得苍白，但面壁计划的真正意义，只有在宇宙社会学两条公理被完全理解之后，才会显现出来。',
  '罗辑在冬眠中醒来时，已是危机纪元二〇五年。他站在新生活五村的街道上，看着湛蓝的天空和空中穿梭的飞行车，意识到两个世纪的时间已经从他的生命中悄无声息地滑过。',
  '生存是文明的第一需要；文明不断增长和扩张，但宇宙中的物质总量保持不变。从这两条公理出发，加上猜疑链与技术爆炸两个概念，整个宇宙就成了一座黑暗森林，每个文明都是带枪的猎人。',
]

export function BookDetailPage() {
  const { id } = useParams()
  const { data: book } = useQuery({ queryKey: ['book', id], queryFn: () => api.book(id!), enabled: !!id })
  const { bookProgress, setBookProgress } = usePrefs()
  const [readerOpen, setReaderOpen] = useState(false)
  const [rating, setRating] = useState<number | null>(null)

  if (!book) return <div className="p-6 text-slate-400">加载中…</div>

  const saved = bookProgress[book.id]
  const pct = saved?.pct ?? book.progressPct
  const chapter = saved?.chapter ?? book.lastChapter
  const page = saved?.page ?? 1
  const total = saved?.total ?? 302
  const readable = book.formats.find((f) => f.readable)

  const savePage = (p: number) => {
    const nextPct = Math.min(100, Math.round((p / total) * 100))
    setBookProgress(book.id, { pct: nextPct, chapter: `第 ${Math.ceil(p / 12) + 1} 章`, page: p, total })
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <BackLink to="/books">书籍浏览</BackLink>

      <div className="mt-4 flex flex-col gap-8 md:flex-row">
        {/* 左：封面 + 格式 */}
        <div className="w-52 shrink-0 space-y-4">
          <HueCover hue={book.hue} dir={160} className="aspect-[3/4] rounded-lg p-4 shadow-lg" >
            <div className="text-lg font-bold leading-tight text-white">{book.title}</div>
            <div className="mt-1 text-xs text-white/60">{book.author} 著</div>
          </HueCover>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {book.formats.map((f) => (
              <div key={f.kind} className={`flex items-center justify-between px-3 py-2.5 ${f.readable ? '' : 'opacity-70'}`}>
                <div>
                  <Badge tone={f.kind === 'EPUB' ? 'green' : f.kind === 'PDF' ? 'brand' : 'amber'}>{f.kind}</Badge>
                  <div className="mt-0.5 text-xs text-slate-400">{f.sizeMB}MB · {f.readable ? '可在线阅读' : '仅下载'}</div>
                </div>
                <button className="text-slate-400 transition hover:text-brand-600"><Download className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>

        {/* 右：信息 */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {book.series && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                系列 · {book.series.name} 第 {book.series.idx}/{book.series.total} 部
              </span>
            )}
            {book.tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t}</span>)}
          </div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <div className="mt-1 text-sm text-slate-500">{book.author || "作者未知"} · {book.publisher || "出版社未知"} · {book.year}</div>
          <div className="mt-2 flex items-center gap-2">
            <RatingStars value={rating ?? book.rating} onChange={setRating} />
            <span className="text-xs text-slate-400">{rating}.0 · 我的评分</span>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">
                {pct === 0 ? '未开始阅读' : pct === 100 ? '已读完' : `在读 · ${pct}%`}
              </span>
              <span className="text-xs text-slate-400">{chapter ? '最近有阅读' : ''}</span>
            </div>
            <div className="mb-3 h-1.5 rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-brand-500 transition-all" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {chapter ? `上次读到：${chapter}` : '点击开始阅读，进度会自动记忆'}
              </div>
              {readable && (
                <Button onClick={() => setReaderOpen(true)}>{pct > 0 ? '继续阅读' : '开始阅读'}</Button>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 text-xs font-semibold text-slate-400">简介</div>
            <p className="text-sm leading-relaxed text-slate-600">{book.desc || "（简介随 M3 元数据解析接入；当前可手动维护备注）"}</p>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-xs font-semibold text-slate-400">元数据</div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex py-2"><dt className="w-24 text-slate-400">ISBN</dt><dd className="font-mono text-xs leading-5">{book.isbn}</dd></div>
              <div className="flex py-2"><dt className="w-24 text-slate-400">语言</dt><dd>{book.language}</dd></div>
              <div className="flex py-2"><dt className="w-24 text-slate-400">文件</dt><dd>{book.formats.length} 个格式 · 共 {book.formats.reduce((s, f) => s + f.sizeMB, 0).toFixed(1)}MB</dd></div>
              <div className="flex py-2"><dt className="w-24 text-slate-400">入库时间</dt><dd>{fmtDate(book.createdAt)}</dd></div>
            </dl>
          </div>
        </div>
      </div>

      {/* 阅读器弹层（示意 foliate-js / pdf.js 容器形态，M3 接入真实渲染） */}
      <Modal open={readerOpen} onClose={() => setReaderOpen(false)} className="fixed inset-0 m-0 h-full w-full max-w-none rounded-none bg-white">
        <div className="flex h-full flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
            <button className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600" onClick={() => setReaderOpen(false)}>
              <X className="h-4 w-4" />关闭阅读器
            </button>
            <div className="text-sm font-medium">{book.title}</div>
            <span className="ml-auto font-mono text-xs text-slate-400">{readable?.kind} · 第 {page} / {total} 页 · {Math.round((page / total) * 100)}%</span>
            <button className="rounded-lg border border-slate-200 px-2 py-1 text-xs">Aa 字号</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-6 py-10 text-[15px] leading-8 text-slate-700">
              <h2 className="mb-4 text-lg font-bold">第 {Math.ceil(page / 12) + 1} 章</h2>
              {READER_PARAGRAPHS.map((p, i) => <p key={i} className="mb-4">{p}</p>)}
              <p className="mt-8 text-center text-slate-300">— {page} —</p>
            </div>
          </div>
          <div className="flex h-12 shrink-0 items-center gap-4 border-t border-slate-200 px-4">
            <Button variant="outline" disabled={page <= 1} onClick={() => savePage(page - 1)}>← 上一页</Button>
            <div className="h-1 flex-1 rounded-full bg-slate-100">
              <div className="h-1 rounded-full bg-brand-500" style={{ width: `${(page / total) * 100}%` }} />
            </div>
            <Button disabled={page >= total} onClick={() => savePage(page + 1)}>下一页 →</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

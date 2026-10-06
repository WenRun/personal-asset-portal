import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { api } from '@/api/client'
import { BackLink, Badge, Button, Modal, RatingStars } from '@/components/ui'
import { fmtDate } from '@/lib/utils'
import type { Book } from '@/types'

/** 书籍详情（§5.4）：真实元数据 + 自建 epub 章节阅读器 / 原生 PDF + 服务端进度（user_progress） */
export function BookDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: book } = useQuery({ queryKey: ['book', id], queryFn: () => api.book(id!), enabled: !!id })
  const { data: progress } = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!), enabled: !!id })
  const [readerOpen, setReaderOpen] = useState(false)
  const [rating, setRating] = useState<number | null>(null)

  if (!book) return <div className="p-6 text-slate-400">加载中…</div>

  const savedPct = typeof progress?.position?.pct === 'number' ? progress.position.pct : null
  const savedChapter = typeof progress?.position?.chapter === 'number' ? progress.position.chapter : null
  const pct = savedPct ?? book.progressPct
  const readable = book.formats.find((f) => f.readable)

  const savePage = (p: { pct: number; chapter?: number }) => {
    void api.saveProgress(book.id, { pct: p.pct, ...(p.chapter !== undefined ? { chapter: p.chapter } : {}) })
    void qc.invalidateQueries({ queryKey: ['progress', book.id] })
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <BackLink to="/books">书籍浏览</BackLink>

      <div className="mt-4 flex flex-col gap-8 md:flex-row">
        <div className="w-52 shrink-0 space-y-4">
          <img
            src={api.bookCoverUrl(book.id, 1024)}
            alt={book.title}
            className="aspect-[3/4] w-full rounded-lg bg-slate-200 object-cover shadow-lg"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {book.formats.map((f) => (
              <div key={f.kind} className={`flex items-center justify-between px-3 py-2.5 ${f.readable ? '' : 'opacity-70'}`}>
                <div>
                  <Badge tone={f.kind === 'EPUB' ? 'green' : f.kind === 'PDF' ? 'brand' : 'amber'}>{f.kind}</Badge>
                  <div className="mt-0.5 text-xs text-slate-400">{f.sizeMB}MB · {f.readable ? '可在线阅读' : '仅下载'}</div>
                </div>
                <a href={api.downloadUrl(book.id)} className="text-slate-400 transition hover:text-brand-600"><Download className="h-4 w-4" /></a>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {book.series && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">系列 · {book.series.name} 第 {book.series.idx} 部</span>
            )}
            {book.tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t}</span>)}
          </div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <div className="mt-1 text-sm text-slate-500">
            {book.author || '作者未知'} · {book.publisher || '出版社未知'} · {book.year}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <RatingStars value={rating ?? book.rating} onChange={setRating} />
            <span className="text-xs text-slate-400">{rating ?? book.rating}.0 · 我的评分</span>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">
                {pct === 0 ? '未开始阅读' : pct >= 100 ? '已读完' : `在读 · ${Math.round(pct)}%`}
              </span>
              {progress && <span className="text-xs text-slate-400">进度已云端同步</span>}
            </div>
            <div className="mb-3 h-1.5 rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-brand-500 transition-all" style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {savedChapter != null ? `上次读到：第 ${savedChapter + 1} 节` : '点击开始阅读，进度会自动记忆到你的账号'}
              </div>
              {readable && (
                <Button onClick={() => setReaderOpen(true)}>{pct > 0 ? '继续阅读' : '开始阅读'}</Button>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 text-xs font-semibold text-slate-400">简介</div>
            <p className="text-sm leading-relaxed text-slate-600">
              {book.desc || '（简介随元数据入库；可在「编辑」中手动维护备注）'}
            </p>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-xs font-semibold text-slate-400">元数据</div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex py-2"><dt className="w-24 shrink-0 text-slate-400">ISBN</dt><dd className="font-mono text-xs leading-5">{book.isbn || '—'}</dd></div>
              <div className="flex py-2"><dt className="w-24 shrink-0 text-slate-400">语言</dt><dd>{book.language || '—'}</dd></div>
              <div className="flex py-2"><dt className="w-24 shrink-0 text-slate-400">文件</dt><dd>{book.formats.map((f) => f.kind).join(' / ')} · 共 {book.formats.reduce((s, f) => s + f.sizeMB, 0).toFixed(1)}MB</dd></div>
              <div className="flex py-2"><dt className="w-24 shrink-0 text-slate-400">入库时间</dt><dd>{fmtDate(book.createdAt)}</dd></div>
            </dl>
          </div>
        </div>
      </div>

      {readerOpen && readable && (
        <ReaderModal book={book} format={readable.kind} initialChapter={savedChapter ?? 0} initialPct={pct}
          onClose={() => setReaderOpen(false)} onProgress={savePage} />
      )}
    </div>
  )
}

/** 清理章节 HTML：去脚本与内联事件（个人库内容，最小化防护） */
function sanitizeChapterHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

function ReaderModal({ book, format, initialChapter, initialPct, onClose, onProgress }: {
  book: Book
  format: string
  initialChapter: number
  initialPct: number
  onClose: () => void
  onProgress: (p: { pct: number; chapter?: number }) => void
}) {
  const isEpub = format === 'EPUB'
  const scrollRef = useRef<HTMLDivElement>(null)
  const [chapter, setChapter] = useState(initialChapter)
  const [pct, setPct] = useState(initialPct)
  const { data: contents } = useQuery({
    queryKey: ['book-contents', book.id],
    queryFn: () => api.bookContents(book.id),
    enabled: isEpub,
  })
  const chapters = contents?.chapters ?? []
  const current = chapters[chapter]

  const { data: html } = useQuery({
    queryKey: ['chapter-html', book.id, current?.href],
    queryFn: () => api.bookResource(book.id, current!.href),
    enabled: isEpub && !!current,
  })

  // 切章 → 存进度 + 回顶部
  useEffect(() => {
    if (!isEpub || chapters.length === 0) return
    const p = Math.round(((chapter + 1) / chapters.length) * 1000) / 10
    setPct(Math.min(p, 100))
    onProgress({ pct: Math.min(p, 100), chapter })
    scrollRef.current?.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, chapters.length, isEpub])

  return (
    <Modal open onClose={onClose} className="fixed inset-0 m-0 h-full w-full max-w-none rounded-none bg-white">
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
          <button className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600" onClick={onClose}>
            <X className="h-4 w-4" />关闭阅读器
          </button>
          <div className="truncate text-sm font-medium">{book.title}</div>
          <span className="ml-auto shrink-0 font-mono text-xs text-slate-400">
            {format} · {isEpub && current ? current.title : ''} · {Math.round(pct)}%
          </span>
        </div>

        {format === 'PDF' ? (
          <iframe src={api.bookFileUrl(book.id)} title={book.title} className="min-h-0 flex-1" />
        ) : (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-2xl px-6 py-10 text-[15px] leading-8 text-slate-700 [&_h1]:mb-6 [&_h1]:text-xl [&_h1]:font-bold [&_p]:mb-4">
              {html
                ? <div dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }} />
                : <div className="py-20 text-center text-slate-300">章节加载中…</div>}
            </div>
          </div>
        )}

        <div className="flex h-12 shrink-0 items-center gap-4 border-t border-slate-200 px-4">
          {isEpub ? (
            <>
              <Button variant="outline" disabled={chapter <= 0}
                onClick={() => setChapter((c) => Math.max(0, c - 1))}>
                <ChevronLeft className="h-4 w-4" />上一节
              </Button>
              <div className="h-1 flex-1 rounded-full bg-slate-100">
                <div className="h-1 rounded-full bg-brand-500 transition-all" style={{ width: `${Math.max(pct, 1)}%` }} />
              </div>
              <Button disabled={chapter >= chapters.length - 1}
                onClick={() => setChapter((c) => Math.min(chapters.length - 1, c + 1))}>
                下一节<ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <div className="flex-1 text-center text-xs text-slate-400">PDF 由浏览器内置阅读器分页</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

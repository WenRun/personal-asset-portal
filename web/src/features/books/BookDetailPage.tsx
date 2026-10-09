import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Link2, Pencil, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { BackLink, Badge, Button, RatingStars } from '@/components/ui'
import { ShareDialog } from '@/components/ShareDialog'
import { DeleteAssetDialog } from '@/components/DeleteAssetDialog'
import { EditAssetDialog } from '@/components/EditAssetDialog'
import { fmtDate } from '@/lib/utils'
import { BookReader } from './BookReader'

/** 书籍详情：多格式支持（EPUB / PDF / MOBI / AZW3 / TXT）+ 现代电子阅读器 + 元数据编辑 */
export function BookDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useAuth((s) => s.user)?.role === 'admin'
  const [shareOpen, setShareOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const { data: book } = useQuery({ queryKey: ['book', id], queryFn: () => api.book(id!), enabled: !!id })
  const { data: progress } = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!), enabled: !!id })
  const [readerOpen, setReaderOpen] = useState(false)
  const [rating, setRating] = useState<number | null>(null)

  if (!book) return <div className="p-6 text-slate-400">加载中…</div>

  const savedPct = typeof progress?.position?.pct === 'number' ? progress.position.pct : null
  const savedChapter = typeof progress?.position?.chapter === 'number' ? progress.position.chapter : null
  const pct = savedPct ?? book.progressPct
  const readable = book.formats.find((f) => f.readable) || book.formats[0]

  const savePage = (p: { pct: number; chapter?: number }) => {
    void api.saveProgress(book.id, { pct: p.pct, ...(p.chapter !== undefined ? { chapter: p.chapter } : {}) })
    void qc.invalidateQueries({ queryKey: ['progress', book.id] })
  }

  const handleRatingChange = (val: number) => {
    setRating(val)
    void api.patchAsset(book.id, { rating: val }).then(() => {
      void qc.invalidateQueries({ queryKey: ['book', book.id] })
    })
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
                  <Badge
                    tone={
                      f.kind === 'EPUB'
                        ? 'green'
                        : f.kind === 'PDF'
                          ? 'brand'
                          : f.kind === 'TXT'
                            ? 'violet'
                            : 'amber'
                    }
                  >
                    {f.kind}
                  </Badge>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {f.sizeMB}MB · {f.readable ? '可在线阅读' : '仅下载'}
                  </div>
                </div>
                <a
                  href={api.downloadUrl(book.id)}
                  download
                  className="text-slate-400 transition hover:text-brand-600"
                  title="下载书籍原文件"
                >
                  <Download className="h-4 w-4" />
                </a>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {book.series && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                系列 · {book.series.name} 第 {book.series.idx} 部
              </span>
            )}
            {book.tags.map((t) => (
              <button
                key={t}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
                title={`查看「${t}」标签下的书籍`}
                onClick={() => nav(`/books?tag=${encodeURIComponent(t)}`)}
              >
                {t}
              </button>
            ))}
            {isAdmin && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-slate-400 transition hover:border-brand-500 hover:text-brand-600"
              >
                + 添加标签
              </button>
            )}
          </div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <div className="mt-1 text-sm text-slate-500">
            {book.author || '作者未知'} · {book.publisher || '出版社未知'} · {book.year}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <RatingStars value={rating ?? book.rating} onChange={handleRatingChange} />
            <span className="text-xs text-slate-400">{(rating ?? book.rating)}.0 · 我的评分</span>

            <div className="ml-auto flex items-center gap-2">
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} title="编辑书籍元信息">
                  <Pencil className="h-3.5 w-3.5" />编辑
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  <Link2 className="h-3.5 w-3.5" />分享
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-rose-600 hover:bg-rose-50"
                  title="删除该书籍"
                  onClick={() => setDelOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
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
              {book.desc || '（简介随元数据入库；可在「编辑」中手动维护备注与简介）'}
            </p>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-xs font-semibold text-slate-400">元数据</div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex py-2">
                <dt className="w-24 shrink-0 text-slate-400">ISBN</dt>
                <dd className="font-mono text-xs leading-5">{book.isbn || '—'}</dd>
              </div>
              <div className="flex py-2">
                <dt className="w-24 shrink-0 text-slate-400">语言</dt>
                <dd>{book.language || '—'}</dd>
              </div>
              <div className="flex py-2">
                <dt className="w-24 shrink-0 text-slate-400">文件</dt>
                <dd>
                  {book.formats.map((f) => f.kind).join(' / ')} · 共 {book.formats.reduce((s, f) => s + f.sizeMB, 0).toFixed(1)}MB
                </dd>
              </div>
              <div className="flex py-2">
                <dt className="w-24 shrink-0 text-slate-400">入库时间</dt>
                <dd>{fmtDate(book.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {readerOpen && readable && (
        <BookReader
          book={book}
          format={readable.kind}
          initialChapter={savedChapter ?? 0}
          initialPct={pct}
          onClose={() => setReaderOpen(false)}
          onProgress={savePage}
        />
      )}

      {editOpen && (
        <EditAssetDialog
          assetId={book.id}
          initialTitle={book.title}
          initialNote={book.desc}
          initialTags={book.tags}
          initialRating={book.rating}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['book', book.id] })
            void qc.invalidateQueries({ queryKey: ['books'] })
          }}
        />
      )}

      <ShareDialog assetId={book.id} assetTitle={book.title} open={shareOpen} onClose={() => setShareOpen(false)} />
      <DeleteAssetDialog assetId={book.id} assetTitle={book.title} listPath="/books" open={delOpen} onClose={() => setDelOpen(false)} />
    </div>
  )
}

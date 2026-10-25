import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

/** meta.ai_enrich 的结构（后端 app/core/ai_enrich.py 写入） */
interface AiEnrichInfo {
  status: 'ok' | 'not_found' | 'error' | 'skipped'
  time: string
  model?: string
  reason?: string
  error?: string
  applied?: string[]
  suggestions?: {
    title?: string
    tags?: string[]
    video?: { kind?: string; series?: string }
    book?: { authors?: string[]; publisher?: string; pub_year?: number }
  } | null
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const APPLIED_LABELS: Record<string, string> = {
  note: '简介',
  suggested_category: '推荐分类',
}

function fmtTokens(u?: { prompt_tokens?: number; completion_tokens?: number }): string {
  if (!u || (u.prompt_tokens == null && u.completion_tokens == null)) return ''
  return `${u.prompt_tokens ?? 0}+${u.completion_tokens ?? 0} tokens`
}

/**
 * AI 识别面板（管理员）：触发按钮 + 结果展示一体。
 * 点击入队后每 4 秒轮询一次（原始 meta + 页面详情查询），识别完成自动展示结果并刷新页面数据，
 * 3 分钟兜底停止。放在各类型详情页的信息区。
 */
export function AiEnrichPanel({ assetId, detailKey }: { assetId: string; detailKey: unknown[] }) {
  const qc = useQueryClient()
  const { data: raw, refetch } = useQuery({
    queryKey: ['ai-enrich', assetId],
    queryFn: () => api.assetRaw(assetId),
    enabled: !!assetId,
  })
  const ai = raw?.meta?.ai_enrich as AiEnrichInfo | undefined

  const [polling, setPolling] = useState(false)
  const [err, setErr] = useState('')
  const baseTimeRef = useRef<string | undefined>(undefined)

  const start = useMutation({
    mutationFn: () => api.aiEnrichAsset(assetId),
    onSuccess: () => {
      setErr('')
      baseTimeRef.current = ai?.time
      setPolling(true)
    },
    onError: (e) => setErr((e as Error).message),
  })

  useEffect(() => {
    if (!polling) return
    // 识别完成（time 变化）即停轮询；3 分钟兜底（模型慢 / 队列积压）
    if (ai?.time && ai.time !== baseTimeRef.current) {
      setPolling(false)
      void qc.invalidateQueries({ queryKey: detailKey })
      return
    }
    const t = setInterval(() => {
      void refetch()
      void qc.invalidateQueries({ queryKey: detailKey })
    }, 4000)
    const stop = setTimeout(() => setPolling(false), 180_000)
    return () => { clearInterval(t); clearTimeout(stop) }
  }, [polling, ai?.time, refetch, qc, detailKey])

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">AI 识别</span>
        <Button
          size="sm"
          variant="outline"
          disabled={start.isPending || polling}
          onClick={() => start.mutate()}
          title="用大模型识别封面/缩略图与文件信息，补全简介、推荐分类，并给出标签等建议（点击即重跑）"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {start.isPending ? '入队中…' : polling ? '识别中…' : ai ? '重新识别' : '识别'}
        </Button>
        <span className="text-xs text-slate-400">
          {polling ? '已入队，完成后此处自动显示结果' : '需先在「设置」页配置大模型'}
        </span>
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>
      {ai && <AiResultCard assetId={assetId} ai={ai} />}
    </div>
  )
}

function AiResultCard({ assetId, ai }: { assetId: string; ai: AiEnrichInfo }) {
  const qc = useQueryClient()
  const [adopted, setAdopted] = useState<string[]>([])
  const adopt = useMutation({
    mutationFn: (fields: string[]) => api.aiAdopt(assetId, fields),
    onSuccess: (_r, fields) => {
      setAdopted((s) => [...s, ...fields])
      // 标签/标题变了：详情与标签列表都要刷新
      void qc.invalidateQueries()
    },
  })

  if (ai.status === 'skipped') {
    return <div className="mt-2 text-xs text-slate-400">本次未执行：{ai.reason || 'AI 未启用'}</div>
  }
  if (ai.status === 'error') {
    return <div className="mt-2 break-all text-xs text-rose-600">识别失败：{ai.error || '未知错误'}（可稍后重试）</div>
  }
  if (ai.status === 'not_found') {
    return <div className="mt-2 text-xs text-slate-400">AI 未能识别出有用信息（可换封面后重试，或手动补全）</div>
  }

  const sug = ai.suggestions || {}
  const adoptedAll = (f: string) => adopted.includes(f)
  const time = ai.time ? new Date(ai.time).toLocaleString('zh-CN', { hour12: false }) : ''

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
      {(ai.applied ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-emerald-600">已自动补全：</span>
          {ai.applied!.map((f) => (
            <span key={f} className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
              {APPLIED_LABELS[f] ?? f}
            </span>
          ))}
          <span className="text-slate-400">（只填空缺，未动已有内容）</span>
        </div>
      )}

      {sug.title && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400">标题建议：</span>
          <span className="font-medium text-slate-700">{sug.title}</span>
          {adoptedAll('title') ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-600"><Check className="h-3 w-3" />已采纳</span>
          ) : (
            <button className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700"
              disabled={adopt.isPending} onClick={() => adopt.mutate(['title'])}>采纳</button>
          )}
        </div>
      )}

      {sug.tags && sug.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400">标签建议：</span>
          {sug.tags.map((t) => (
            <span key={t} className={cn('rounded-full px-2 py-0.5', adoptedAll('tags') ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>
              {t}
            </span>
          ))}
          {adoptedAll('tags') ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-600"><Check className="h-3 w-3" />已挂载</span>
          ) : (
            <button className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700"
              disabled={adopt.isPending} onClick={() => adopt.mutate(['tags'])}>全部挂载</button>
          )}
        </div>
      )}

      {sug.video && (sug.video.series || sug.video.kind) && (
        <div className="text-slate-500">
          系列判断：{sug.video.series ? `「${sug.video.series}」` : '—'}
          {sug.video.kind && ` · 类型 ${sug.video.kind === 'tutorial' ? '教程' : '素材片段'}`}
          <span className="ml-1 text-slate-400">（仅供参考，归属请用任务中心的入库确认队列处理）</span>
        </div>
      )}

      {sug.book && (sug.book.authors?.length || sug.book.publisher || sug.book.pub_year) && (
        <div className="text-slate-500">
          出版信息建议：{[sug.book.authors?.join(' / '), sug.book.publisher, sug.book.pub_year].filter(Boolean).join(' · ') || '—'}
          <span className="ml-1 text-slate-400">（可在「编辑」弹窗里照抄）</span>
        </div>
      )}

      <div className="text-[10px] text-slate-300">
        {ai.model} · {time}{fmtTokens(ai.usage) && ` · ${fmtTokens(ai.usage)}`}
      </div>
    </div>
  )
}

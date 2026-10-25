import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { Badge, Button, Chip, PageHeader } from '@/components/ui'
import type { JobPayload, JobTarget } from '@/api/client'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

// ---------- 中文描述映射（内部任务代码 → 展示名；未知代码原样兜底） ----------
const KIND_LABELS: Record<string, string> = {
  scan_root: '扫描目录',
  fingerprint: '计算文件指纹',
  'parse:font': '解析字体信息',
  'parse:music': '解析音乐信息',
  'parse:video': '解析视频信息',
  'parse:book': '解析书籍信息',
  'parse:image': '解析图片信息',
  'parse:generic': '解析资产信息',
  index_meili: '更新搜索索引',
  'derive:music_cover': '生成专辑封面',
  'derive:thumb_image': '生成图片缩略图',
  'derive:book_cover': '生成书籍封面',
  'scrape:book': '刮削图书信息',
  ai_enrich: 'AI 识别元数据',
  'derive:font_specimen': '生成字体样张',
  'derive:font_charset': '统计字体字符集',
  pack_zip: '打包下载 ZIP',
}

const TYPE_LABELS: Record<string, string> = { font: '字体', music: '音乐', video: '视频', book: '书籍', image: '图片' }
const TYPE_TONES: Record<string, 'slate' | 'brand' | 'green' | 'amber' | 'violet'> = {
  font: 'violet', music: 'brand', video: 'amber', book: 'green', image: 'slate',
}

const MAX_ATTEMPTS = 3 // 与后端 BACKOFFS 长度一致：失败自动退避重试，共 3 次后判失败

/** 毫秒 → 「X 秒 / X 分 X 秒 / X 小时 X 分」 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return '<1 秒'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

/** 资产详情页路由（音乐无单曲页，跳所属专辑；已软删的记录不再跳转） */
function detailPath(t: JobTarget): string | null {
  if (t.type !== 'asset' || t.deleted || !t.asset_id) return null
  switch (t.asset_type) {
    case 'font': return `/fonts/${t.asset_id}`
    case 'video': return `/videos/${t.asset_id}`
    case 'book': return `/books/${t.asset_id}`
    case 'image': return `/images/${t.asset_id}`
    case 'music': return t.album_id ? `/music/albums/${t.album_id}` : null
    default: return null
  }
}

function TargetCell({ j }: { j: JobPayload }) {
  const t = j.target
  if (!t) {
    // 后端未能反查（资产已被物理清理等）时回退显示 payload 原始值
    const raw = (j.payload.root_alias as string) ?? (j.payload.storage_key as string) ?? (j.payload.asset_id as string) ?? '—'
    return <span className="block max-w-56 truncate font-mono text-xs text-slate-400" title={raw}>{raw}</span>
  }
  if (t.type === 'root') {
    return (
      <span className="text-slate-600">资源目录 <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{t.root_alias}</code></span>
    )
  }
  if (t.type === 'pack') {
    return <span className="text-slate-600">打包任务{t.file_count != null && <span className="text-slate-400"> · {t.file_count} 个文件</span>}</span>
  }
  const path = detailPath(t)
  return (
    <div className="flex max-w-72 items-center gap-1.5" title={t.file_name ?? undefined}>
      {t.asset_type && <Badge tone={TYPE_TONES[t.asset_type] ?? 'slate'} className="shrink-0">{TYPE_LABELS[t.asset_type] ?? t.asset_type}</Badge>}
      {path ? (
        <Link to={path} className="min-w-0 flex-1 truncate hover:text-brand-600 hover:underline">{t.title || t.file_name}</Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-slate-600">{t.title || t.file_name}</span>
      )}
      {t.deleted && <Badge tone="red" className="shrink-0">已删除</Badge>}
    </div>
  )
}

/** 耗时列：运行中实时跳动（父组件每秒刷新 now）；完成显示实际执行耗时；
 *  失败后重新排队的显示下次重试倒计时（由 run_at 推算）。 */
function DurationCell({ j, now }: { j: JobPayload; now: number }) {
  if (j.status === 'running') {
    const start = j.started_at ?? j.created_at
    return <span className="text-brand-600">{fmtDuration(now - new Date(start).getTime())}</span>
  }
  if (j.status === 'done' && j.finished_at) {
    const start = j.started_at ?? j.created_at
    return (
      <span className="text-slate-500" title={j.started_at ? '实际执行耗时（不含排队）' : '该任务无开始时间记录，为总耗时（含排队）'}>
        {fmtDuration(new Date(j.finished_at).getTime() - new Date(start).getTime())}
      </span>
    )
  }
  if (j.status === 'queued' && j.attempts > 0) {
    const wait = new Date(j.run_at).getTime() - now
    return <span className="text-amber-600">{wait <= 0 ? '即将重试' : `约 ${fmtDuration(wait)}后重试`}</span>
  }
  return <span className="text-slate-300">—</span>
}

export function JobsPage() {
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 10_000 })
  // 任务列表数据统一走 REST 分页接口；SSE 只当「有变更」信号（version+1 触发当前页重查）。
  // 快照本身只含最新 100 条，翻页/筛选后的数据以 REST 为准；断线由 EventSource 自动重连。
  const [live, setLive] = useState<'connecting' | 'live'>('connecting')
  const [version, setVersion] = useState(0)
  useEffect(() => api.jobsStream(() => setVersion((v) => v + 1), setLive), [])
  const { data: confirms } = useQuery({ queryKey: ['confirm'], queryFn: api.confirmList, refetchInterval: 15_000 })
  const { data: bookConfirms } = useQuery({ queryKey: ['bookConfirm'], queryFn: api.bookConfirmList, refetchInterval: 15_000 })
  const [tab, setTab] = useState<'jobs' | 'confirm'>('jobs')
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const [statusFilter, setStatusFilter] = useState<'all' | JobPayload['status']>('all')
  const [page, setPage] = useState(1)
  const { data: pageData, isFetching } = useQuery({
    queryKey: ['jobs', page, statusFilter, version],
    queryFn: () => api.jobs({
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  })
  const confirmSeries = useMutation({
    mutationFn: (v: { id: string; name: string; ep: number }) => api.confirmSeries(v.id, v.name, v.ep),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['confirm'] }),
  })
  const bookApply = useMutation({
    mutationFn: (v: { assetId: string; candidateId: string }) => api.bookConfirmApply(v.assetId, v.candidateId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookConfirm'] }),
  })
  const bookSkip = useMutation({
    mutationFn: (assetId: string) => api.bookConfirmSkip(assetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookConfirm'] }),
  })
  const [scrapeMsg, setScrapeMsg] = useState('')
  const scrapeMissing = useMutation({
    mutationFn: (force: boolean) => api.scrapeMissingBooks(force),
    onSuccess: (r) => {
      setScrapeMsg(`已入队 ${r.enqueued} 本，稍后可在任务中心看进度；搜出多个候选的会出现在这里`)
      setTimeout(() => setScrapeMsg(''), 6000)
      void qc.invalidateQueries({ queryKey: ['bookConfirm'] })
    },
  })

  // AI 批量识别：一期四类；书籍只处理在线刮削已到头的（豆瓣/Google 免费且权威，优先）
  const AI_TYPES = [
    { key: 'image', label: '图片' },
    { key: 'video', label: '视频' },
    { key: 'book', label: '书籍' },
    { key: 'font', label: '字体' },
  ] as const
  const [aiTypes, setAiTypes] = useState<string[]>(['image'])
  const [aiForce, setAiForce] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  const aiBatch = useMutation({
    mutationFn: () => api.aiEnrichBatch(aiTypes, aiForce),
    onSuccess: (r) => {
      const parts = [`已入队 ${r.enqueued} 条`]
      if (r.capped) parts.push('（达单次 500 条上限，可稍后再点继续）')
      setAiMsg(parts.join('') + '，进度见下方任务列表；识别结果到各详情页查看与采纳')
      setTimeout(() => setAiMsg(''), 8000)
    },
    onError: (e) => { setAiMsg((e as Error).message); setTimeout(() => setAiMsg(''), 8000) },
  })
  const runAiBatch = () => {
    const labels = aiTypes.map((t) => AI_TYPES.find((x) => x.key === t)?.label ?? t).join('、')
    if (confirm(
      aiForce
        ? `对${labels}全部资源强制重跑 AI 识别？\n将逐条调用大模型（每类单次最多 500 条），确认继续？`
        : `对${labels}中缺简介且未识别过的资源批量 AI 识别？\n书籍仅含刮削未收录的。每类单次最多 500 条，确认继续？`,
    )) aiBatch.mutate()
  }

  const retry = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    // 重试成功后无需手动刷新：retry 端点会发 NOTIFY，SSE 推 snapshot → version 变化 → 当前页重查
  })

  // 有运行中/待重试任务时每秒刷新一次时钟，供耗时列实时跳动
  const [now, setNow] = useState(() => Date.now())
  const items = pageData?.items ?? []
  const needsTick = items.some((j) => j.status === 'running' || (j.status === 'queued' && j.attempts > 0))
  useEffect(() => {
    if (!needsTick) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [needsTick])

  const total = pageData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const countOf = (s: JobPayload['status']) => pageData?.counts?.[s] ?? 0
  const pendingConfirms = (confirms?.length ?? 0) + (bookConfirms?.length ?? 0)

  // 任务删除 / 批量删除：仅删除任务记录本身，不影响资产数据；运行中的任务不可删
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const delJob = useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
  const batchDelJobs = useMutation({
    mutationFn: (ids: string[]) => api.batchDeleteJobs(ids),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['jobs'] }) },
  })
  // 批量重试：仅失败页提供；非失败状态后端自动跳过
  const batchRetryJobs = useMutation({
    mutationFn: (ids: string[]) => api.batchRetryJobs(ids),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['jobs'] }) },
  })
  const pageIds = items.filter((j) => j.status !== 'running').map((j) => j.id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const toggleSelect = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleSelectAll = () =>
    setSelected((s) => {
      const n = new Set(s)
      if (allSelected) pageIds.forEach((id) => n.delete(id))
      else pageIds.forEach((id) => n.add(id))
      return n
    })
  const changePage = (p: number) => { setPage(p); setSelected(new Set()) }
  const doDelete = (j: JobPayload) => {
    if (confirm(`删除任务「${KIND_LABELS[j.kind] ?? j.kind}」的记录？\n仅删除任务记录本身，不影响资产数据。`)) delJob.mutate(j.id)
  }
  const doBatchDelete = () => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (confirm(`删除选中的 ${ids.length} 条任务记录？\n仅删除任务记录本身，不影响资产数据；运行中的会自动跳过。`)) batchDelJobs.mutate(ids)
  }
  const doBatchRetry = () => {
    const ids = [...selected]
    if (ids.length > 0) batchRetryJobs.mutate(ids)
  }

  const applyFilter = (v: 'all' | JobPayload['status']) => {
    setStatusFilter(v)
    changePage(1) // 换筛选回第一页，避免留在超出结果的页码上
  }

  const statusPill = (s: JobPayload['status']) =>
    s === 'running' ? <Badge tone="brand">运行中</Badge>
      : s === 'failed' ? <Badge tone="red">失败</Badge>
        : s === 'done' ? <Badge tone="green">完成</Badge>
          : <Badge>队列中</Badge>

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="管理端"
        sub="worker 并发 2 · 轮询 1.5s · 失败自动退避重试 3 次"
        right={
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs', live === 'live' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', live === 'live' ? 'animate-pulse bg-emerald-500' : 'bg-slate-400')} />
            {live === 'live' ? '实时推送已连接' : '重连中…'}
          </span>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['队列中', stats?.jobs.queued, 'text-slate-800'],
          ['运行中', stats?.jobs.running, 'text-brand-600'],
          ['失败', stats?.jobs.failed, 'text-rose-600'],
          ['今日完成', stats?.jobs.done_today, 'text-slate-800'],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-400">{label as string}</div>
            <div className={`mt-1 text-2xl font-bold ${cls as string}`}>{value ?? '—'}</div>
          </div>
        ))}
        <button
          onClick={() => setTab('confirm')}
          className={cn('rounded-xl border bg-white p-4 text-left transition hover:shadow-md',
            pendingConfirms > 0 ? 'border-amber-300' : 'border-slate-200')}
        >
          <div className="text-xs text-slate-400">待确认入库</div>
          <div className={cn('mt-1 text-2xl font-bold', pendingConfirms > 0 ? 'text-amber-600' : 'text-slate-300')}>{pendingConfirms}</div>
        </button>
      </div>

      <div className="mt-4 flex w-fit gap-1 rounded-lg bg-slate-200/70 p-1 text-sm">
        <button className={`rounded-md px-4 py-1.5 transition ${tab === 'jobs' ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab('jobs')}>任务中心</button>
        <button className={`rounded-md px-4 py-1.5 transition ${tab === 'confirm' ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab('confirm')}>
          入库确认队列
        </button>
      </div>

      {tab === 'jobs' ? (
        <>
          {/* AI 批量识别：配置在「设置」页；花钱的活批量前先确认 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span className="font-medium text-slate-700">AI 批量识别</span>
            <span className="text-xs text-slate-400">识别对象：所选类型中缺简介的资源（图片/视频看图，书籍看封面，字体看样张）</span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {AI_TYPES.map((t) => (
                <Chip key={t.key} active={aiTypes.includes(t.key)} onClick={() =>
                  setAiTypes((s) => (s.includes(t.key) ? s.filter((x) => x !== t.key) : [...s, t.key]))}>
                  {t.label}
                </Chip>
              ))}
              <label className="ml-2 flex items-center gap-1 text-xs text-slate-500" title="忽略识别记录对所选类型全量重跑（更花 token）">
                <input type="checkbox" className="accent-brand-600" checked={aiForce} onChange={(e) => setAiForce(e.target.checked)} />强制重跑
              </label>
              <Button size="sm" disabled={aiTypes.length === 0 || aiBatch.isPending} onClick={runAiBatch}>
                {aiBatch.isPending ? '入队中…' : '批量识别'}
              </Button>
            </div>
            {aiMsg && <span className="w-full text-xs text-brand-600">{aiMsg}</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            {([['all', '全部'], ['queued', '队列中'], ['running', '运行中'], ['failed', '失败'], ['done', '完成']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => applyFilter(v)}
                className={cn('rounded-full border px-2.5 py-1 transition',
                  statusFilter === v ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300')}
              >
                {label}
                {v === 'all' && <span className="ml-1 text-slate-400">{Object.values(pageData?.counts ?? {}).reduce((a, b) => a + b, 0)}</span>}
                {v !== 'all' && (
                  <span className={cn('ml-1', v === 'failed' && countOf('failed') > 0 && statusFilter !== 'failed' ? 'text-rose-500' : 'text-slate-400')}>
                    {countOf(v)}
                  </span>
                )}
              </button>
            ))}
          </div>

          {selected.size > 0 && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm">
              <span className="font-medium text-brand-700">已选 {selected.size} 条</span>
              {statusFilter === 'failed' && (
                <Button size="sm" disabled={batchRetryJobs.isPending} onClick={doBatchRetry}>
                  <RefreshCw className="h-3 w-3" />批量重试
                </Button>
              )}
              <Button size="sm" className="bg-rose-600 hover:bg-rose-500" disabled={batchDelJobs.isPending} onClick={doBatchDelete}>
                <Trash2 className="h-3 w-3" />批量删除
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>取消选择</Button>
            </div>
          )}

          <div className={cn('mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white transition', isFetching && 'opacity-60')}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-400">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allSelected}
                      disabled={pageIds.length === 0} title="全选本页（运行中除外）" onChange={toggleSelectAll} />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">任务</th>
                  <th className="px-4 py-2.5 text-left font-medium">对象</th>
                  <th className="px-4 py-2.5 text-left font-medium">状态</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">尝试</th>
                  <th className="px-4 py-2.5 text-left font-medium">耗时</th>
                  <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((j) => (
                  <tr key={j.id} className={j.status === 'failed' ? 'bg-rose-50/40' : ''}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(j.id)}
                        disabled={j.status === 'running'} title={j.status === 'running' ? '运行中的任务不可删除' : undefined}
                        onChange={() => toggleSelect(j.id)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-700">{KIND_LABELS[j.kind] ?? j.kind}</div>
                      <code className="text-[10px] text-slate-400">{j.kind}</code>
                    </td>
                    <td className="px-4 py-2.5"><TargetCell j={j} /></td>
                    <td className="px-4 py-2.5">
                      {statusPill(j.status)}
                      {j.last_error && <div className="mt-0.5 max-w-64 truncate font-mono text-[10px] text-rose-500" title={j.last_error}>{j.last_error}</div>}
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-400 sm:table-cell" title={`失败自动退避重试（30秒 / 5分钟 / 30分钟），共 ${MAX_ATTEMPTS} 次；人工重试会清零`}>
                      {j.attempts}<span className="text-slate-300">/{MAX_ATTEMPTS}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5"><DurationCell j={j} now={now} /></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">{new Date(j.created_at).toLocaleString('zh-CN')}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {j.status === 'failed' && (
                          <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={() => retry.mutate(j.id)}><RefreshCw className="h-3 w-3" />重试</Button>
                        )}
                        {j.status !== 'running' && (
                          <Button size="sm" variant="outline" className="whitespace-nowrap text-slate-500 hover:text-rose-600" title="删除任务记录" onClick={() => doDelete(j)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {(total === 0 || items.length === 0) && (
                  <tr><td colSpan={8} className="p-10 text-center text-slate-400">
                    {total === 0 && statusFilter === 'all'
                      ? '还没有任务 —— 上传或扫描后，这里会出现「扫描目录 → 计算文件指纹 → 解析 → 更新搜索索引」链路'
                      : '该状态下暂无任务'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>共 {total} 条任务</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <span className={cn(isFetching && 'opacity-50')}>第 {page} / {totalPages} 页</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 space-y-3">
          {/* 图书刮削：批量补信息入口 + 多候选人工选择 */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="font-medium text-slate-700">图书信息补全（豆瓣优先 · Google 兜底）</span>
            <span className="text-xs text-slate-400">缺作者/出版社/ISBN/简介/评分/封面的书自动补齐；只填空缺，不覆盖已有内容；多候选人工确认</span>
            <Button size="sm" className="ml-auto" disabled={scrapeMissing.isPending} onClick={() => scrapeMissing.mutate(false)}>
              <BookOpen className="h-3.5 w-3.5" />批量刮削缺失图书
            </Button>
            <Button size="sm" variant="outline" disabled={scrapeMissing.isPending}
              title="忽略已有结果强制重刮全部（人工跳过的除外）。封面反盗链/年份择优等修复上线后用它补全存量"
              onClick={() => { if (confirm('强制重刮全部图书？（人工「跳过」的仍会跳过）\n用于修复上线后补全豆瓣封面/评分，约需 1~2 小时。')) scrapeMissing.mutate(true) }}>
              强制重刮
            </Button>
            {scrapeMsg && <span className="text-xs text-brand-600">{scrapeMsg}</span>}
          </div>

          {(bookConfirms ?? []).map((b) => (
            <BookConfirmCard key={b.asset_id} item={b}
              onApply={(cid) => bookApply.mutate({ assetId: b.asset_id, candidateId: cid })}
              onSkip={() => bookSkip.mutate(b.asset_id)} />
          ))}

          {(confirms ?? []).filter((c) => !dismissed[c.id]).map((c) => (
            <ConfirmCard key={c.id} item={c}
              onConfirm={(name, ep) => confirmSeries.mutate({ id: c.id, name, ep })}
              onSkip={() => setDismissed((d) => ({ ...d, [c.id]: true }))} />
          ))}
          {(confirms ?? []).length - Object.keys(dismissed).length <= 0 && (bookConfirms ?? []).length <= 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
              队列清空 ✓（视频系列识别存疑、图书刮削多候选时会出现在这里待人工确认）
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function ConfirmCard({ item, onConfirm, onSkip }: {
  item: { id: string; file: string; hint: string; series_name: string | null; episode_hint: number | null }
  onConfirm: (name: string, ep: number) => void
  onSkip: () => void
}) {
  // 系列名优先用当前归属系列（章节卷积后即课程名），集数用后端按顺序递增的建议值
  const guessedName = item.file.replace(/\.[^.]+$/, "").replace(/[ ._-]*(S\d+E\d+|第\d+[讲集课回]|EP?\d+).*$/i, "") || item.file
  const [name, setName] = useState(item.series_name ?? guessedName)
  const [ep, setEp] = useState(item.episode_hint ?? 1)
  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4">
      <div className="text-sm font-medium">{item.file}</div>
      <div className="mt-0.5 text-xs text-slate-400">{item.hint}</div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 outline-none focus:border-brand-500" />
        <span className="text-slate-400">第</span>
        <input type="number" value={ep} onChange={(e) => setEp(Number(e.target.value))}
          className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center outline-none focus:border-brand-500" />
        <span className="text-slate-400">集</span>
        <Button size="sm" onClick={() => onConfirm(name, ep)}>确认</Button>
        <Button size="sm" variant="outline" onClick={() => onSkip()}>跳过</Button>
      </div>
    </div>
  )
}


type BookConfirmCandidate = {
  source_id: string; title: string; authors: string[]; publisher: string | null
  pub_year: number | null; isbn: string | null; cover_url: string | null
  rating: number | null; rating_source?: string | null; source?: 'google' | 'douban'; series_name?: string | null
}

/** 图书刮削多候选卡片：管理员从豆瓣/Google 候选里选正确条目应用（只填空缺字段），或跳过此书 */
function BookConfirmCard({ item, onApply, onSkip }: {
  item: { asset_id: string; title: string; file_name: string; authors: string[]; hint: string; candidates: BookConfirmCandidate[] }
  onApply: (candidateId: string) => void
  onSkip: () => void
}) {
  const [picked, setPicked] = useState(item.candidates[0]?.source_id ?? '')
  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-4">
      <div className="flex items-baseline gap-2">
        <div className="text-sm font-medium">{item.title || item.file_name}</div>
        <div className="truncate text-xs text-slate-400">{item.file_name}{item.authors.length > 0 && ` · ${item.authors.join(' / ')}`}</div>
        <Button size="sm" variant="outline" className="ml-auto shrink-0 text-slate-500" onClick={() => onSkip()}>跳过此书</Button>
      </div>
      <div className="mt-0.5 text-xs text-slate-400">{item.hint}</div>
      <div className="mt-3 space-y-1.5">
        {item.candidates.map((c) => (
          <label key={c.source_id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-xs transition ${picked === c.source_id ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
            <input type="radio" className="accent-brand-600" checked={picked === c.source_id} onChange={() => setPicked(c.source_id)} />
            {c.cover_url && (
              <img src={c.cover_url} alt="" referrerPolicy="no-referrer" className="h-14 w-10 shrink-0 rounded-sm object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-slate-700">{c.title}</span>
                <span className={`shrink-0 rounded px-1 py-px text-[10px] ${c.source === 'douban' ? 'bg-green-50 text-green-600' : 'bg-sky-50 text-sky-600'}`}>
                  {c.source === 'douban' ? '豆瓣' : 'Google'}
                </span>
                {c.series_name && <span className="shrink-0 text-[10px] text-slate-400">{c.series_name}</span>}
              </span>
              <span className="block truncate text-slate-400">
                {[c.authors.join(' / '), c.publisher, c.pub_year, c.isbn].filter(Boolean).join(' · ')}
              </span>
            </span>
            {c.rating != null && (
              <span className={`shrink-0 font-medium ${c.source === 'douban' ? 'text-green-600' : 'text-amber-500'}`}>
                {c.source === 'douban' ? `${c.rating.toFixed(1)}分` : `★ ${c.rating.toFixed(1)}`}
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!picked} onClick={() => onApply(picked)}>应用所选</Button>
      </div>
    </div>
  )
}

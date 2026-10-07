import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/api/client'
import { Badge, Button, PageHeader } from '@/components/ui'
import type { JobPayload } from '@/api/client'
import { cn } from '@/lib/utils'

export function JobsPage() {
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 10_000 })
  // 任务列表走 SSE 实时推送（替代轮询）；断线 EventSource 自动重连，重连后重推快照
  const [jobs, setJobs] = useState<JobPayload[] | undefined>(undefined)
  const [live, setLive] = useState<'connecting' | 'live'>('connecting')
  useEffect(() => api.jobsStream(setJobs, setLive), [])
  const { data: confirms } = useQuery({ queryKey: ['confirm'], queryFn: api.confirmList, refetchInterval: 15_000 })
  const [tab, setTab] = useState<'jobs' | 'confirm'>('jobs')
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const confirmSeries = useMutation({
    mutationFn: (v: { id: string; name: string; ep: number }) => api.confirmSeries(v.id, v.name, v.ep),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['confirm'] }),
  })

  const retry = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    // 重试成功后无需手动刷新：retry 端点会发 NOTIFY，SSE 立刻推新快照
  })

  const targetOf = (j: JobPayload) =>
    (j.payload.root_alias as string) ?? (j.payload.storage_key as string) ?? (j.payload.asset_id as string) ?? '—'

  const statusPill = (s: JobPayload['status']) =>
    s === 'running' ? <Badge tone="brand">运行中</Badge>
      : s === 'failed' ? <Badge tone="red">失败</Badge>
        : s === 'done' ? <Badge tone="green">完成</Badge>
          : <Badge>队列中</Badge>

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="管理端"
        sub="worker 并发 2 · DB 队列轮询 1.5s"
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
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-400">待确认入库</div>
          <div className="mt-1 text-2xl font-bold text-slate-300">0</div>
        </div>
      </div>

      <div className="mt-4 flex w-fit gap-1 rounded-lg bg-slate-200/70 p-1 text-sm">
        <button className={`rounded-md px-4 py-1.5 transition ${tab === 'jobs' ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab('jobs')}>任务中心</button>
        <button className={`rounded-md px-4 py-1.5 transition ${tab === 'confirm' ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab('confirm')}>
          入库确认队列
        </button>
      </div>

      {tab === 'jobs' ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">任务</th>
                <th className="px-4 py-2.5 text-left font-medium">对象</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">尝试</th>
                <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(jobs ?? []).map((j) => (
                <tr key={j.id} className={j.status === 'failed' ? 'bg-rose-50/40' : ''}>
                  <td className="px-4 py-2.5"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{j.kind}</code></td>
                  <td className="max-w-56 truncate px-4 py-2.5 text-slate-600" title={targetOf(j)}>{targetOf(j)}</td>
                  <td className="px-4 py-2.5">
                    {statusPill(j.status)}
                    {j.last_error && <div className="mt-0.5 font-mono text-[10px] text-rose-500">{j.last_error}</div>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-slate-400 sm:table-cell">{j.attempts}</td>
                  <td className="px-4 py-2.5 text-slate-400">{new Date(j.created_at).toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-2.5 text-right">
                    {j.status === 'failed' && (
                      <Button size="sm" variant="outline" onClick={() => retry.mutate(j.id)}><RefreshCw className="h-3 w-3" />重试</Button>
                    )}
                  </td>
                </tr>
              ))}
              {(jobs ?? []).length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-slate-400">还没有任务 —— 上传或扫描后这里会出现 fingerprint → parse → index 链路</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {(confirms ?? []).filter((c) => !dismissed[c.id]).map((c) => (
            <ConfirmCard key={c.id} item={c}
              onConfirm={(name, ep) => confirmSeries.mutate({ id: c.id, name, ep })}
              onSkip={() => setDismissed((d) => ({ ...d, [c.id]: true }))} />
          ))}
          {(confirms ?? []).length - Object.keys(dismissed).length <= 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
              队列清空 ✓（视频系列识别存疑时会出现在这里，人工校对系列名与集数）
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function ConfirmCard({ item, onConfirm, onSkip }: {
  item: { id: string; file: string; hint: string }
  onConfirm: (name: string, ep: number) => void
  onSkip: () => void
}) {
  const [name, setName] = useState(item.file.replace(/\.[^.]+$/, "").replace(/[ ._-]*(S\d+E\d+|第\d+[讲集课回]|EP?\d+).*$/i, "") || item.file)
  const [ep, setEp] = useState(1)
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
        <Button size="sm" variant="outline" onClick={onSkip}>跳过</Button>
      </div>
    </div>
  )
}

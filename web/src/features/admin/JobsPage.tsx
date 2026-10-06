import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/api/client'
import { Badge, Button, Chip, PageHeader } from '@/components/ui'
import type { Job } from '@/types'
import { STATS } from '@/mocks/data'

export function JobsPage() {
  const { data: initial } = useQuery({ queryKey: ['jobs'], queryFn: api.jobs })
  const { data: confirms } = useQuery({ queryKey: ['confirms'], queryFn: api.confirmItems })
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [pending, setPending] = useState<string[] | null>(null)
  const [tab, setTab] = useState<'jobs' | 'confirm'>('jobs')

  const list = jobs ?? initial ?? []
  const confirmList = (confirms ?? []).filter((c) => !(pending ?? []).includes(c.id))

  const retry = (id: string) => setJobs((js) => (js ?? initial ?? []).map((j) => (j.id === id ? { ...j, status: 'queued', attempts: 0 } : j)))

  const statusPill = (s: Job['status']) =>
    s === 'running' ? <Badge tone="brand">运行中</Badge>
      : s === 'failed' ? <Badge tone="red">失败</Badge>
        : s === 'done' ? <Badge tone="green">完成</Badge>
          : <Badge>队列中</Badge>

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="管理端" sub="worker 在线 · 并发 2 · DB 队列轮询 1.5s（mock）" />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['队列中', STATS.jobsQueued, 'text-slate-800'],
          ['运行中', STATS.jobsRunning, 'text-brand-600'],
          ['失败', STATS.jobsFailed, 'text-rose-600'],
          ['今日完成', STATS.jobsDoneToday, 'text-slate-800'],
          ['待确认入库', confirmList.length, 'text-amber-500'],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-400">{label as string}</div>
            <div className={`mt-1 text-2xl font-bold ${cls as string}`}>{value as number}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex w-fit gap-1 rounded-lg bg-slate-200/70 p-1 text-sm">
        <button className={`rounded-md px-4 py-1.5 transition ${tab === 'jobs' ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab('jobs')}>任务中心</button>
        <button className={`rounded-md px-4 py-1.5 transition ${tab === 'confirm' ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setTab('confirm')}>
          入库确认队列 <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{confirmList.length}</span>
        </button>
      </div>

      {tab === 'jobs' ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">任务</th>
                <th className="px-4 py-2.5 text-left font-medium">对象</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-left font-medium">尝试</th>
                <th className="px-4 py-2.5 text-left font-medium">时间</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((j) => (
                <tr key={j.id} className={j.status === 'failed' ? 'bg-rose-50/40' : ''}>
                  <td className="px-4 py-2.5"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{j.kind}</code></td>
                  <td className="px-4 py-2.5 text-slate-600">{j.target}</td>
                  <td className="px-4 py-2.5">
                    {statusPill(j.status)}
                    {j.error && <div className="mt-0.5 font-mono text-[10px] text-rose-500">{j.error}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{j.attempts}</td>
                  <td className="px-4 py-2.5 text-slate-400">{j.at}</td>
                  <td className="px-4 py-2.5 text-right">
                    {j.status === 'failed' && (
                      <Button size="sm" variant="outline" onClick={() => retry(j.id)}><RefreshCw className="h-3 w-3" />重试</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold">入库确认队列 · 系列识别存疑 <span className="ml-1 text-xs font-normal text-slate-400">（对应详细设计 §5.3 need_confirm）</span></div>
          <div className="grid gap-3 md:grid-cols-2">
            {confirmList.map((c) => (
              <div key={c.id} className="rounded-xl border border-amber-200 bg-white p-4">
                <div className="text-sm font-medium">{c.file}</div>
                <div className="mt-0.5 text-xs text-slate-400">{c.hint}</div>
                <div className="text-xs text-amber-600">候选：沿用目录系列「{c.seriesGuess}」第 {c.episode} 集</div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <input defaultValue={c.seriesGuess} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 outline-none focus:border-brand-500" />
                  <span className="text-slate-400">第</span>
                  <input defaultValue={c.episode} className="w-12 rounded-lg border border-slate-200 px-2 py-1.5 text-center outline-none focus:border-brand-500" />
                  <span className="text-slate-400">集</span>
                  <Button size="sm" onClick={() => setPending((p) => [...(p ?? []), c.id])}>确认</Button>
                  <Button size="sm" variant="outline" onClick={() => setPending((p) => [...(p ?? []), c.id])}>跳过</Button>
                </div>
              </div>
            ))}
            {confirmList.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">全部处理完毕 ✓</div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <Chip active>任务种类：fingerprint / parse:* / derive:* / index_meili / pack_zip / scan_root</Chip>
      </div>
    </div>
  )
}

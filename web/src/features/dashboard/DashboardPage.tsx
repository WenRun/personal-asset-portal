import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, API_BASE } from '@/api/client'
import { assetHit, type Hit } from '@/lib/search'
import { Badge, HueCover, PageHeader } from '@/components/ui'

function RecentCardCover({ hit }: { hit: Hit }) {
  const [failed, setFailed] = useState(false)
  const fullCoverUrl = hit.coverUrl ? (hit.coverUrl.startsWith('http') ? hit.coverUrl : `${API_BASE}${hit.coverUrl}`) : null

  if (fullCoverUrl && !failed) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 shadow-sm transition hover:opacity-90">
        <img
          src={fullCoverUrl}
          alt={hit.title}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  return (
    <HueCover hue={hit.hue ?? 245} className="grid aspect-square place-items-center rounded-lg text-2xl text-white/90 transition hover:opacity-90">
      <span>{hit.glyph ?? '·'}</span>
    </HueCover>
  )
}

export function DashboardPage() {
  const qc = useQueryClient()
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 15_000 })
  const { data: recentRaw } = useQuery({ queryKey: ['recent'], queryFn: () => api.recent(12) })
  const nav = useNavigate()

  const recent = (recentRaw ?? []).map(assetHit)

  const cards = [
    { label: '字体', count: stats?.counts.font, to: '/fonts', hue: 245 },
    { label: '音乐', count: stats?.counts.music, to: '/music', hue: 285 },
    { label: '视频', count: stats?.counts.video, to: '/videos', hue: 205 },
    { label: '书籍', count: stats?.counts.book, to: '/books', hue: 25 },
    { label: '图片', count: stats?.counts.image, to: '/images', hue: 155 },
  ]

  const onCardClick = (to: string) => {
    if (to === '/videos') {
      void qc.invalidateQueries({ queryKey: ['videos'], refetchType: 'all' })
      void qc.invalidateQueries({ queryKey: ['video-series'], refetchType: 'all' })
    } else if (to === '/music') {
      void qc.invalidateQueries({ queryKey: ['music-albums'], refetchType: 'all' })
      void qc.invalidateQueries({ queryKey: ['music-tracks'], refetchType: 'all' })
    } else if (to === '/books') {
      void qc.invalidateQueries({ queryKey: ['books'], refetchType: 'all' })
    } else if (to === '/images') {
      void qc.invalidateQueries({ queryKey: ['photos'], refetchType: 'all' })
    } else if (to === '/fonts') {
      void qc.invalidateQueries({ queryKey: ['fonts'], refetchType: 'all' })
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="仪表盘" sub="资源总览与最近动态" />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            onClick={() => onCardClick(c.to)}
            className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-md"
          >
            <div className="flex items-center gap-2">
              <HueCover hue={c.hue} className="h-2.5 w-2.5 rounded-full" />
              <span className="text-xs text-slate-400">{c.label}</span>
            </div>
            <div className="mt-2 text-2xl font-bold group-hover:text-brand-600">{c.count ?? '—'}</div>
            <div className="mt-0.5 text-xs text-slate-400">已入库资产</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">最近入库</div>
            <span className="text-xs text-slate-400">跨五类聚合</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {recent.slice(0, 8).map((h) => (
              <div key={h.to} className="group cursor-pointer" onClick={() => nav(h.to)}>
                <RecentCardCover hit={h} />
                <div className="mt-1 truncate text-xs font-medium group-hover:text-brand-600">{h.title}</div>
                <div className="truncate text-[10px] text-slate-400">{h.sub}</div>
              </div>
            ))}
            {recent.length === 0 && (
              <div className="col-span-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
                还没有资源 —— 用右上角「上传」或让管理员配置扫描目录
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">任务状态</div>
            <Link to="/jobs" className="text-xs text-brand-600 hover:underline">任务中心 →</Link>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">队列中</span><span className="font-mono">{stats?.jobs.queued ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">运行中</span><span className="font-mono text-brand-600">{stats?.jobs.running ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">失败</span><span className="font-mono text-rose-600">{stats?.jobs.failed ?? '—'}</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><span className="text-slate-400">今日完成</span><span className="font-mono">{stats?.jobs.done_today ?? '—'}</span></div>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-400">
            worker 在线 · 并发 2 · <Badge tone="green">DB 队列</Badge>
          </div>
        </div>
      </div>
    </div>
  )
}

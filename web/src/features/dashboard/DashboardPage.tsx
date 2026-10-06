import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { searchAll } from '@/lib/search'
import { fmtDate } from '@/lib/utils'
import { Badge, HueCover, PageHeader } from '@/components/ui'
import { STATS } from '@/mocks/data'

export function DashboardPage() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const nav = useNavigate()

  const recents = searchAll('', 999)
  const recentItems = [
    ...recents.fonts.map((h) => ({ ...h, when: '' })),
    ...recents.music, ...recents.videos, ...recents.books, ...recents.images,
  ]

  const cards = [
    { label: '字体', value: stats ? `${STATS.fontsFiles}` : '—', sub: `${stats?.fontFamilies ?? '—'} 个字族`, to: '/fonts', hue: 245 },
    { label: '音乐', value: stats ? String(stats.albums) : '—', sub: `${stats?.tracks ?? '—'} 首曲目`, to: '/music', hue: 285 },
    { label: '视频', value: stats ? String(stats.seriesCount) : '—', sub: `系列 · 另有 ${stats?.clips ?? '—'} 个素材`, to: '/videos', hue: 205 },
    { label: '书籍', value: stats ? String(stats.books) : '—', sub: 'EPUB / PDF / MOBI', to: '/books', hue: 25 },
    { label: '图片', value: stats ? stats.images : '—', sub: '含 RAW + 手机原图', to: '/images', hue: 155 },
  ]

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader title="仪表盘" sub="资源总览与最近动态" />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-md">
            <div className="flex items-center gap-2">
              <HueCover hue={c.hue} className="h-2.5 w-2.5 rounded-full" />
              <span className="text-xs text-slate-400">{c.label}</span>
            </div>
            <div className="mt-2 text-2xl font-bold group-hover:text-brand-600">{c.value}</div>
            <div className="mt-0.5 text-xs text-slate-400">{c.sub}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">最近入库</div>
            <span className="text-xs text-slate-400">跨五类聚合</span>
          </div>
          <div className="grid grid-cols-4 gap-2 md:grid-cols-4">
            {recentItems.slice(0, 8).map((h) => (
              <div key={h.to + h.title} className="cursor-pointer" onClick={() => nav(h.to)}>
                <HueCover hue={h.hue ?? 245} className="grid aspect-square place-items-center rounded-lg text-2xl text-white/90 transition hover:opacity-90">
                  <span>{h.glyph ?? '·'}</span>
                </HueCover>
                <div className="mt-1 truncate text-xs font-medium">{h.title}</div>
                <div className="truncate text-[10px] text-slate-400">{h.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">任务状态</div>
            <Link to="/jobs" className="text-xs text-brand-600 hover:underline">任务中心 →</Link>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">队列中</span><span className="font-mono">{stats?.jobsQueued ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">运行中</span><span className="font-mono text-brand-600">{stats?.jobsRunning ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">失败</span><span className="font-mono text-rose-600">{stats?.jobsFailed ?? '—'}</span></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><span className="text-slate-400">今日完成</span><span className="font-mono">{stats?.jobsDoneToday ?? '—'}</span></div>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-400">
            worker 在线 · 并发 2 · <Badge tone="green">DB 队列</Badge>
          </div>
        </div>
      </div>

      <div className="mt-6 text-xs text-slate-400">
        当前为 Mock 数据阶段：界面与交互已完成，数据层通过 <code className="rounded bg-slate-200 px-1">src/api/client.ts</code> 接缝接入，
        M0 后端就绪后逐个替换为真实 REST API。页面骨架对应《详细设计》§7。
      </div>
    </div>
  )
}

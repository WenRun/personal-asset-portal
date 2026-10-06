import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { useAssetNav, Badge, Chip, HueCover, PageHeader } from '@/components/ui'
import { fmtDate } from '@/lib/utils'
import { STATS } from '@/mocks/data'

export function VideosPage() {
  const { data: series } = useQuery({ queryKey: ['series'], queryFn: api.series })
  const { data: clips } = useQuery({ queryKey: ['clips'], queryFn: api.clips })
  const nav = useAssetNav()
  const { videoProgress } = usePrefs()
  const [filter, setFilter] = useState<'all' | 'series' | 'clip' | 'playable' | 'fav'>('all')

  const progressOf = (sid: string, watched: number) => videoProgress[sid]?.ep ?? watched
  const pctOf = (sid: string, watched: number, total: number) => Math.round(((videoProgress[sid]?.ep ?? watched) / total) * 100)

  const showSeries = filter === 'all' || filter === 'series' || filter === 'playable' || filter === 'fav'
  const showClips = filter === 'all' || filter === 'clip' || (filter === 'playable')

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="视频" sub={`${STATS.seriesCount} 个教程系列 · ${STATS.clips} 个素材（mock 展示 ${series?.length ?? 0} + ${clips?.length ?? 0}）`} />

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        <Chip active={filter === 'series'} onClick={() => setFilter('series')}>教程系列</Chip>
        <Chip active={filter === 'clip'} onClick={() => setFilter('clip')}>素材</Chip>
        <Chip active={filter === 'playable'} onClick={() => setFilter('playable')}>可在线播放</Chip>
      </div>

      {showSeries && (
        <>
          <div className="mb-3 mt-6 text-xs font-semibold text-slate-400">教程系列 · 点击进入系列详情</div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {(series ?? [])
              .filter((s) => filter !== 'playable' || s.playableAll)
              .map((s) => {
                const cur = progressOf(s.id, s.watched)
                const done = cur >= s.episodes.length
                const pct = pctOf(s.id, s.watched, s.episodes.length)
                return (
                  <div key={s.id} className="group cursor-pointer" onClick={() => nav(`/videos/${s.id}`)}>
                    <HueCover hue={s.hue} className="aspect-video rounded-xl shadow-sm transition group-hover:shadow-md">
                      <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{s.episodes.length} 集 · {s.sizeGB}GB</span>
                      {done
                        ? <span className="absolute right-2 top-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">✓ 已看完</span>
                        : cur > 0 && <span className="absolute right-2 top-2 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">看到 {cur}/{s.episodes.length}</span>}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
                        <div className="mb-2 h-1 rounded-full bg-white/25"><div className={`h-1 rounded-full ${done ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} /></div>
                        <div className="truncate text-sm font-medium text-white">{s.title}</div>
                      </div>
                    </HueCover>
                    <div className="mt-1.5 truncate text-xs text-slate-400">{s.resolution} · {s.codec.split(' / ')[0]} · {fmtDate(s.addedAt)} 入库</div>
                  </div>
                )
              })}
          </div>
        </>
      )}

      {showClips && (
        <>
          <div className="mb-3 mt-8 text-xs font-semibold text-slate-400">素材片段（clip）· 最近入库</div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
            {(clips ?? [])
              .filter((c) => filter !== 'playable' || c.playable)
              .map((c) => (
                <div key={c.id} className="group cursor-pointer" onClick={() => nav(`/videos/${c.id}`)}>
                  <HueCover hue={c.hue} className="aspect-video rounded-xl transition group-hover:shadow-md">
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {Math.floor(c.durationSec / 60)}:{String(c.durationSec % 60).padStart(2, '0')}
                    </span>
                    <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] text-white ${c.playable ? 'bg-emerald-600/90' : 'bg-amber-600/90'}`}>
                      {c.playable ? '可播放' : '仅下载'}
                    </span>
                  </HueCover>
                  <div className="mt-1.5 truncate text-sm font-medium">{c.title}</div>
                  <div className="truncate text-xs text-slate-400">{fmtDate(c.addedAt)} · {c.resolution} · {c.sizeMB}MB</div>
                </div>
              ))}
          </div>
        </>
      )}

      {filter === 'fav' && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">收藏过滤为 mock 演示位</div>
      )}
    </div>
  )
}

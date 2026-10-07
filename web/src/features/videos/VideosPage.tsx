import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, API_BASE } from '@/api/client'
import { useAssetNav, Badge, Chip, HueCover, PageHeader } from '@/components/ui'
import { fmtDate, fmtTime } from '@/lib/utils'

type SeriesDetailed = Awaited<ReturnType<typeof api.videoSeries>>[number] & {
  episodeList: Awaited<ReturnType<typeof api.seriesEpisodes>>['episodes']
}

export function VideosPage() {
  const [params, setParams] = useSearchParams()
  const tagFilter = params.get('tag') ?? ''
  const clearTag = () => { const p = new URLSearchParams(params); p.delete('tag'); setParams(p, { replace: true }) }
  const { data: videos } = useQuery({
    queryKey: ['videos', tagFilter],
    queryFn: () => api.videos(tagFilter ? { tag: tagFilter } : undefined),
  })
  const { data: series } = useQuery({
    queryKey: ['video-series'],
    queryFn: async (): Promise<SeriesDetailed[]> => {
      const all = await api.videoSeries()
      return Promise.all(all.map(async (s) => ({ ...s, episodeList: (await api.seriesEpisodes(s.id)).episodes })))
    },
  })
  const nav = useAssetNav()
  const [filter, setFilter] = useState<'all' | 'series' | 'clip' | 'playable'>('all')

  const seriesList = useMemo(() => {
    const all = series ?? []
    if (!tagFilter) return all
    // 标签过滤时：系列只要有任一剧集带该标签就保留（剧集资产也在 tag 过滤结果里）
    const tagged = new Set((videos ?? []).map((v) => v.id))
    return all.filter((s) => s.episodeList.some((e) => tagged.has(e.asset_id)))
  }, [series, videos, tagFilter])
  const seriesAssetIds = useMemo(() => new Set(seriesList.flatMap((s) => s.episodeList.map((e) => e.asset_id))), [seriesList])
  const clips = useMemo(() => (videos ?? []).filter((v) => !seriesAssetIds.has(v.id)), [videos, seriesAssetIds])
  const showSeries = filter === 'all' || filter === 'series'
  const showClips = filter === 'all' || filter === 'clip' || filter === 'playable'

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="视频"
        sub={`${seriesList.length} 个教程系列 · ${clips.length} 个素材（ffprobe 解析 · Direct Play）`}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        {tagFilter && <Chip active onClick={clearTag}>标签：{tagFilter} ✕</Chip>}
        <Chip active={filter === 'series'} onClick={() => setFilter('series')}>教程系列</Chip>
        <Chip active={filter === 'clip'} onClick={() => setFilter('clip')}>素材</Chip>
        <Chip active={filter === 'playable'} onClick={() => setFilter('playable')}>可在线播放</Chip>
      </div>

      {showSeries && (
        <>
          <div className="mb-3 mt-6 text-xs font-semibold text-slate-400">教程系列 · 点击进入系列详情</div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {seriesList.map((s) => {
              const watchedEp = s.episodeList.filter((e) => e.position_sec > 0).length
              const done = watchedEp >= s.episodes && s.episodes > 0
              const hue = s.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
              return (
                <div key={s.id} className="group cursor-pointer" onClick={() => nav(`/videos/${s.episodeList[0]?.asset_id ?? s.id}`)}>
                  <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800 shadow-sm transition group-hover:shadow-md">
                    {s.cover_url ? (
                      <img src={API_BASE + s.cover_url} alt={s.name} className="h-full w-full object-cover" />
                    ) : (
                      <HueCover hue={hue} className="h-full w-full" />
                    )}
                    <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      {s.episodes} 集 · {fmtTime(s.duration_sec)}
                    </span>
                    {done ? (
                      <span className="absolute right-2 top-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">✓ 已看完</span>
                    ) : watchedEp > 0 ? (
                      <span className="absolute right-2 top-2 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">看到 {watchedEp}/{s.episodes}</span>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
                      <div className="h-1 rounded-full bg-white/25">
                        <div className={`h-1 rounded-full ${done ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${s.episodes ? (watchedEp / s.episodes) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-slate-400">{s.duration_sec > 0 ? `总时长 ${fmtTime(s.duration_sec)}` : ''}</div>
                </div>
              )
            })}
            {seriesList.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
                还没有系列 —— 文件名含 S01E02 / 第02讲 / EP02 的视频会自动聚合成系列
              </div>
            )}
          </div>
        </>
      )}

      {showClips && (
        <>
          <div className="mb-3 mt-8 text-xs font-semibold text-slate-400">素材片段（clip）· 最近入库</div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
            {clips
              .filter((c) => filter !== 'playable' || c.playable)
              .map((c) => {
                const hue = c.id.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
                return (
                  <div key={c.id} className="group cursor-pointer" onClick={() => nav(`/videos/${c.id}`)}>
                    <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800 transition group-hover:shadow-md">
                      {c.cover_url ? (
                        <img src={API_BASE + c.cover_url} alt={c.title} className="h-full w-full object-cover" />
                      ) : (
                        <HueCover hue={hue} className="h-full w-full" />
                      )}
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {c.durationSec ? fmtTime(c.durationSec) : `${c.sizeMB}MB`}
                      </span>
                      <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] text-white ${c.playable ? 'bg-emerald-600/90' : 'bg-amber-600/90'}`}>
                        {c.playable ? '可播放' : '仅下载'}
                      </span>
                    </div>
                    <div className="mt-1.5 truncate text-sm font-medium">{c.title}</div>
                    <div className="truncate text-xs text-slate-400">{fmtDate(c.addedAt)} · {c.resolution || c.codec || ''}</div>
                  </div>
                )
              })}
            {clips.filter((c) => filter !== 'playable' || c.playable).length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
                没有符合条件的视频 —— 上传 mp4/mkv/mov/webm/avi 或让管理员扫描 videos 目录
              </div>
            )}
          </div>
        </>
      )}
      <div className="mt-6 text-center text-xs text-slate-400">
        系列识别规则：S01E02 / 第02讲 / EP02 / 父目录（存疑进确认队列）
      </div>
    </div>
  )
}

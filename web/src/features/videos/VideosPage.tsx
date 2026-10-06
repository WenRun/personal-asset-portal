import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { useAssetNav, Badge, Chip, HueCover, PageHeader } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

export function VideosPage() {
  const { data: videos } = useQuery({ queryKey: ['videos'], queryFn: api.videos })
  const nav = useAssetNav()
  const { videoProgress } = usePrefs()
  const [filter, setFilter] = useState<'all' | 'playable' | 'download'>('all')

  const list = useMemo(() => {
    const arr = videos ?? []
    if (filter === 'playable') return arr.filter((c) => c.playable)
    if (filter === 'download') return arr.filter((c) => !c.playable)
    return arr
  }, [videos, filter])

  const playableCount = (videos ?? []).filter((v) => v.playable).length

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="视频"
        sub={`${videos?.length ?? 0} 个视频文件（M0 为文件级资产 · 系列/集数识别与在线播放随 M5 接入）`}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        <Chip active={filter === 'playable'} onClick={() => setFilter('playable')}>可在线播放 · {playableCount}</Chip>
        <Chip active={filter === 'download'} onClick={() => setFilter('download')}>仅下载 · {(videos?.length ?? 0) - playableCount}</Chip>
      </div>

      <div className="mb-3 mt-6 text-xs font-semibold text-slate-400">素材片段（clip）· 最近入库</div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
        {list.map((c) => {
          const watchedEp = videoProgress[c.id]
          return (
            <div key={c.id} className="group cursor-pointer" onClick={() => nav(`/videos/${c.id}`)}>
              <HueCover hue={c.hue} className="aspect-video rounded-xl shadow-sm transition group-hover:shadow-md">
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {c.sizeMB}MB
                </span>
                <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] text-white ${c.playable ? 'bg-emerald-600/90' : 'bg-amber-600/90'}`}>
                  {c.playable ? '可播放' : '仅下载'}
                </span>
                {watchedEp && watchedEp.pos > 0 && (
                  <span className="absolute right-2 top-2 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">看过</span>
                )}
              </HueCover>
              <div className="mt-1.5 truncate text-sm font-medium">{c.title}</div>
              <div className="truncate text-xs text-slate-400">
                {fmtDate(c.addedAt)} · {c.resolution || extLabel(c.title)} · {c.note ? '有备注' : '—'}
              </div>
            </div>
          )
        })}
        {list.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
            没有符合条件的视频 —— 上传 mp4/mkv/mov/webm/avi 或让管理员扫描 videos 目录
          </div>
        )}
      </div>
    </div>
  )
}

function extLabel(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toUpperCase()
}

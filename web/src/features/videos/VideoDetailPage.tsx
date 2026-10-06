import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play } from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { BackLink, Badge, Button, HueCover } from '@/components/ui'
import { fmtDate, fmtTime } from '@/lib/utils'

/** 视频详情：M0 为文件级素材——mock 播放计时 + 进度记忆；HLS/系列集数随 M5 接入 */
export function VideoDetailPage() {
  const { id } = useParams()
  const { data: video } = useQuery({ queryKey: ['video', id], queryFn: () => api.video(id!), enabled: !!id })
  const { videoProgress, setVideoProgress } = usePrefs()
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)

  const saved = id ? videoProgress[id]?.pos ?? 0 : 0

  // mock 播放计时（真实 Direct Play 在 M5 替换 <video>）
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setPos((p) => p + 1), 1000)
    return () => clearInterval(t)
  }, [playing])

  useEffect(() => {
    if (id && pos > 0 && pos % 5 === 0) setVideoProgress(id, { ep: 1, pos })
  }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!video) return <div className="p-6 text-slate-400">加载中…</div>

  const shownPos = pos > 0 ? pos : saved
  const resume = shownPos > 30 && pos === 0

  return (
    <div className="p-4 md:p-6">
      <BackLink to="/videos">视频墙</BackLink>

      <div className="mt-4 max-w-4xl space-y-4">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-950 shadow">
          <HueCover hue={video.hue} className="absolute inset-0 opacity-70" />
          <div className="absolute inset-0 grid place-items-center">
            <button
              className="grid h-16 w-16 place-items-center rounded-full bg-brand-600/90 text-white shadow-xl transition hover:scale-110"
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" fill="currentColor" />}
            </button>
          </div>
          {resume && !playing && (
            <div className="absolute left-3 top-3 rounded-md bg-black/70 px-2.5 py-1 text-xs text-white">上次看到 {fmtTime(shownPos)} · 点击续播</div>
          )}
          {!video.playable && (
            <div className="absolute right-3 top-3 rounded-md bg-amber-600/90 px-2.5 py-1 text-xs text-white">容器不支持在线播放 · 仅下载</div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
            <div className="mb-2 h-1 cursor-pointer rounded-full bg-white/20">
              <div className="h-1 rounded-full bg-brand-500" style={{ width: `${Math.min(100, shownPos)}%` }} />
            </div>
            <div className="flex items-center gap-3 text-xs text-white">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" fill="currentColor" />}
              <span className="font-mono">{fmtTime(shownPos)}</span>
              <span className="ml-auto">mock 计时 · 真实播放随 M5 接入</span>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold text-brand-600">素材片段</div>
          <h1 className="text-xl font-bold">{video.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {video.resolution && <Badge>{video.resolution}</Badge>}
            <Badge>{video.sizeMB}MB</Badge>
            <Badge tone={video.playable ? 'green' : 'amber'}>{video.playable ? '可在线播放' : '仅下载'}</Badge>
            <span className="text-slate-400">{fmtDate(video.addedAt)} 入库</span>
          </div>
          {video.note && <p className="mt-3 text-sm leading-relaxed text-slate-600">{video.note}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {(video.tags ?? []).map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button>下载视频</Button>
          <Button variant="outline">★ 评分</Button>
          <Button variant="outline">编辑</Button>
        </div>
      </div>
    </div>
  )
}

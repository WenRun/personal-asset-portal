import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play } from 'lucide-react'
import { api } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { BackLink, Badge, Button, HueCover } from '@/components/ui'
import { cn, fmtDate, fmtTime } from '@/lib/utils'

/** 视频详情：系列（集数列表 + mock 播放器 + 进度记忆）或单个素材 */
export function VideoDetailPage() {
  const { id } = useParams()
  const { data: video } = useQuery({ queryKey: ['video', id], queryFn: () => api.video(id!), enabled: !!id })
  const { videoProgress, setVideoProgress } = usePrefs()

  const isSeries = video?.kind === 'tutorial'
  const saved = id ? videoProgress[id] : undefined
  const [ep, setEp] = useState(saved?.ep ?? 1)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)

  const series = isSeries ? (video as Exclude<typeof video, undefined> & { episodes?: { idx: number; title: string; durationSec: number; playable: boolean }[] }) : undefined
  const episodes = useMemo(() => series?.episodes ?? [], [series])
  const curEp = episodes.find((e) => e.idx === ep)
  const clip = !isSeries && video ? (video as Exclude<typeof video, undefined> & { durationSec?: number }) : undefined
  const durationSec = curEp?.durationSec ?? clip?.durationSec ?? 0
  const playable = (curEp?.playable ?? clip?.playable ?? false)

  // 切集 / 切视频时恢复进度
  useEffect(() => {
    if (saved && saved.ep === ep) setPos(saved.pos)
    else setPos(0)
    setPlaying(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ep])

  // mock 播放计时：每秒 +1，写回进度（对应真实实现 POST /api/progress 节流 5s）
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setPos((p) => {
        if (p + 1 >= durationSec) { setPlaying(false); if (id) setVideoProgress(id, { ep, pos: 0 }); return 0 }
        return p + 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [playing, durationSec, ep, id, setVideoProgress])

  useEffect(() => {
    if (id && playing) setVideoProgress(id, { ep, pos })
  }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!video) return <div className="p-6 text-slate-400">加载中…</div>

  const resume = pos > 30
  const pct = durationSec ? (pos / durationSec) * 100 : 0
  const isClip = video.kind === 'clip'

  return (
    <div className="p-4 md:p-6">
      <BackLink to="/videos">视频墙</BackLink>

      <div className="mt-4 flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          {/* 播放器占位：M0 视频模块阶段替换为 <video> Direct Play / hls.js */}
          <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-950 shadow">
            <HueCover hue={video.hue} className="absolute inset-0 opacity-70" />
            <div className="absolute inset-0 grid place-items-center">
              <button
                className="grid h-16 w-16 place-items-center rounded-full bg-brand-600/90 text-white shadow-xl transition hover:scale-110"
                onClick={() => playable && setPlaying(!playing)}
                disabled={!playable}
              >
                {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" fill="currentColor" />}
              </button>
            </div>
            {resume && !playing && (
              <div className="absolute left-3 top-3 rounded-md bg-black/70 px-2.5 py-1 text-xs text-white">上次看到 {fmtTime(pos)} · 点击续播</div>
            )}
            {!playable && (
              <div className="absolute right-3 top-3 rounded-md bg-amber-600/90 px-2.5 py-1 text-xs text-white">容器不支持在线播放 · 仅下载</div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
              <div className="mb-2 h-1 cursor-pointer rounded-full bg-white/20" onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setPos(Math.floor(((e.clientX - rect.left) / rect.width) * durationSec))
              }}>
                <div className="h-1 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-3 text-xs text-white">
                {playing
                  ? <button onClick={() => setPlaying(false)}><Pause className="h-4 w-4" /></button>
                  : <button onClick={() => setPlaying(true)}><Play className="h-4 w-4" fill="currentColor" /></button>}
                <span className="font-mono">{fmtTime(pos)} / {fmtTime(durationSec)}</span>
                <span className="ml-auto">{video.resolution} · {video.codec ?? ''} · 1.0×</span>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold text-brand-600">
              {isClip ? '素材片段' : `教程系列 · 第 ${ep} 集`}
            </div>
            <h1 className="text-xl font-bold">{isClip ? video.title : curEp?.title ?? video.title}</h1>
            {!isClip && <div className="mt-1 text-sm text-slate-400">{video.title}（共 {episodes.length} 集）</div>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge>{video.resolution}</Badge>
              {video.codec && <Badge>{video.codec}</Badge>}
              <Badge>{isClip ? `${(video as { sizeMB: number }).sizeMB}MB` : `${video.sizeGB}GB`}</Badge>
              <Badge tone={playable ? 'green' : 'amber'}>{playable ? '可在线播放' : '仅下载'}</Badge>
              <span className="text-slate-400">{fmtDate(video.addedAt)} 入库</span>
            </div>
            {video.note && <p className="mt-3 text-sm leading-relaxed text-slate-600">{video.note}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {video.tags?.map((t) => <Badge key={t}>{t}</Badge>)}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button>下载{isClip ? '视频' : '本集'}</Button>
            {!isClip && <Button variant="outline">打包整个系列 ({episodes.length} 集 · {video.sizeGB}GB)</Button>}
            <Button variant="outline">★ 评分</Button>
            <Button variant="outline">编辑</Button>
          </div>
        </div>

        {/* 系列集数列表 */}
        {!isClip && (
          <div className="w-full shrink-0 xl:w-80">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">{video.title}</div>
                  <div className="text-[10px] text-slate-400">{episodes.length} 集 · {video.sizeGB}GB</div>
                </div>
                <Badge tone="brand">看到 {saved?.ep ?? 0}/{episodes.length}</Badge>
              </div>
              <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto text-sm">
                {episodes.map((e) => {
                  const active = e.idx === ep
                  const epPct = active && pos > 0 ? (pos / e.durationSec) * 100 : 0
                  return (
                    <div
                      key={e.idx}
                      className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 transition', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                      onClick={() => setEp(e.idx)}
                    >
                      <span className={cn('w-6 text-center text-xs', active ? 'font-bold text-brand-600' : e.idx < ep ? 'text-emerald-500' : 'text-slate-300')}>
                        {e.idx < ep ? '✓' : active ? '▶' : String(e.idx).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={cn('truncate', active && 'font-medium')}>{e.title}</div>
                        {active && epPct > 0 && (
                          <div className="mt-1 h-1 rounded-full bg-slate-200"><div className="h-1 rounded-full bg-brand-500" style={{ width: `${epPct}%` }} /></div>
                        )}
                      </div>
                      <span className="font-mono text-xs text-slate-400">{fmtTime(e.durationSec)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

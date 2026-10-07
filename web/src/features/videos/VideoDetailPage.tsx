import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Link2, Pause, Play } from 'lucide-react'
import { api, API_BASE } from '@/api/client'
import { usePrefs } from '@/stores/prefs'
import { useAuth } from '@/stores/auth'
import { BackLink, Badge, Button, HueCover } from '@/components/ui'
import { ShareDialog } from '@/components/ShareDialog'
import { cn, fmtDate, fmtTime } from '@/lib/utils'

/** 视频详情（§5.3）：Direct Play <video> 真实播放 + 观看进度云端同步 + 系列集数切换 */
export function VideoDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useAuth((s) => s.user)?.role === 'admin'
  const [shareOpen, setShareOpen] = useState(false)
  const { data: video } = useQuery({ queryKey: ['video', id], queryFn: () => api.video(id!), enabled: !!id })
  const { data: progress } = useQuery({ queryKey: ['progress', id], queryFn: () => api.getProgress(id!), enabled: !!id })
  const videoRef = useRef<HTMLVideoElement>(null)
  const [coverFail, setCoverFail] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  // 系列上下文：从列表页跳转时由路由 state 传入；直接访问时按需取
  const [series, setSeries] = useState<Awaited<ReturnType<typeof api.seriesEpisodes>> | null>(null)

  const savedSec = typeof progress?.position?.seconds === 'number' ? progress.position.seconds : 0
  const durationSec = video?.durationSec ?? 0

  // 系列集数（若属于系列）：从系列列表反查
  useEffect(() => {
    if (!video || video.kind !== 'tutorial' || !video.series_id) return
    void api.videoSeries().then((all) => {
      const s = all.find((x) => x.name === video.title.split(/ S\d+E\d+| EP?\d+$/)[0] || x.id === video.series_id)
      if (!s) return
      void api.seriesEpisodes(s.id).then((d) => setSeries(d))
    })
  }, [video])

  // 播放/暂停
  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }

  // 挂载恢复进度 + 播放器事件（真实播放：timeupdate 驱动，5s 节流上报）
  useEffect(() => {
    const v = videoRef.current
    if (!v || !id) return
    if (savedSec > 5 && savedSec < (durationSec || Infinity) - 5) v.currentTime = savedSec
    let last = 0
    const onTime = () => {
      setPos(v.currentTime)
      if (v.currentTime - last >= 5) {
        last = v.currentTime
        void api.saveProgress(id, { seconds: v.currentTime })
      }
    }
    const onPause = () => { setPlaying(false); void api.saveProgress(id, { seconds: v.currentTime }) }
    const onPlay = () => setPlaying(true)
    const onEnded = () => { setPlaying(false); void api.saveProgress(id, { seconds: 0 }) }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('pause', onPause)
    v.addEventListener('play', onPlay)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, video, progress])

  if (!video) return <div className="p-6 text-slate-400">加载中…</div>

  const resume = savedSec > 5 && pos === 0
  const pct = durationSec ? (pos / durationSec) * 100 : 0
  const isClip = video.kind === 'clip'

  const switchEpisode = (assetId: string) => {
    qc.invalidateQueries({ queryKey: ['video', assetId] })
    window.history.replaceState(null, '', `/videos/${assetId}`)
    window.location.reload()
  }

  return (
    <div className="p-4 md:p-6">
      <BackLink to="/videos">视频墙</BackLink>

      <div className="mt-4 flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          {/* Direct Play：真实 <video>（Range 流）；不支持时占位 + 仅下载 */}
          {video.playable ? (
            <div className="relative overflow-hidden rounded-xl bg-black shadow">
              {coverFail && !playing ? (
                <HueCover hue={video.hue} className="aspect-video" />
              ) : (
                <video
                  ref={videoRef}
                  src={api.videoStreamUrl(video.id)}
                  poster={video.cover_url ? API_BASE + video.cover_url : undefined}
                  className="aspect-video w-full"
                  onClick={toggle}
                  onError={() => setCoverFail(true)}
                  controls={false}
                />
              )}
              {!playing && !coverFail && (
                <button
                  className="absolute inset-0 grid place-items-center"
                  onClick={() => { const v = videoRef.current; if (v) { if (savedSec > 5 && v.currentTime < 1) v.currentTime = savedSec; void v.play() } }}
                >
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-600/90 text-white shadow-xl transition hover:scale-110">
                    <Play className="ml-1 h-7 w-7" fill="currentColor" />
                  </span>
                </button>
              )}
              {resume && !playing && (
                <div className="absolute left-3 top-3 rounded-md bg-black/70 px-2.5 py-1 text-xs text-white">上次看到 {fmtTime(savedSec)} · 点击续播</div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
                <div className="mb-2 h-1 cursor-pointer rounded-full bg-white/20" onClick={(e) => {
                  const v = videoRef.current
                  if (!v || !durationSec) return
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  v.currentTime = ((e.clientX - rect.left) / rect.width) * durationSec
                }}>
                  <div className="h-1 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center gap-3 text-xs text-white">
                  {playing ? <Pause className="h-4 w-4" onClick={toggle} /> : <Play className="h-4 w-4" fill="currentColor" onClick={toggle} />}
                  <span className="font-mono">{fmtTime(pos)} / {fmtTime(durationSec)}</span>
                  <span className="ml-auto">{video.resolution || ''} · {video.codec || ''} · Direct Play</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-950 shadow">
              <HueCover hue={video.hue} className="absolute inset-0 opacity-70" />
              <div className="absolute inset-0 grid place-items-center">
                <div className="rounded-lg bg-amber-600/90 px-4 py-2 text-sm text-white">容器/编码不支持在线播放（Direct Play）· 仅下载</div>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[10px] font-semibold text-brand-600">
              {isClip ? '素材片段' : `教程系列 · 第 ${video.episode ?? '?'} 集`}
            </div>
            <h1 className="text-xl font-bold">{video.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              {video.resolution && <Badge>{video.resolution}</Badge>}
              {video.codec && <Badge>{video.codec}</Badge>}
              <Badge>{video.sizeMB}MB</Badge>
              <Badge tone={video.playable ? 'green' : 'amber'}>{video.playable ? '可在线播放' : '仅下载'}</Badge>
              <span className="text-slate-400">{fmtDate(video.addedAt)} 入库</span>
            </div>
            {video.note && <p className="mt-3 text-sm leading-relaxed text-slate-600">{video.note}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {(video.tags ?? []).map((t) => (
                <button key={t} className="transition hover:opacity-75" title={`查看「${t}」标签下的视频`} onClick={() => nav(`/videos?tag=${encodeURIComponent(t)}`)}>
                  <Badge>{t}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {video.playable ? (
              <Button onClick={toggle}>{playing ? '暂停' : '播放'}</Button>
            ) : (
              <Button disabled>仅下载（不支持在线播放）</Button>
            )}
            <a href={api.downloadUrl(video.id)}>
              <Button variant="outline">下载{isClip ? '视频' : '本集'}</Button>
            </a>
            {!isClip && <Button variant="outline">★ 评分</Button>}
            <Button variant="outline">编辑</Button>
            {isAdmin && (
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <Link2 className="h-3.5 w-3.5" />分享
              </Button>
            )}
          </div>
        </div>

        {/* 系列集数列表 */}
        {series && (
          <div className="w-full shrink-0 xl:w-80">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">{series.name}</div>
                  <div className="text-[10px] text-slate-400">{series.episode_count} 集</div>
                </div>
                <Badge tone="brand">看到 {series.watched}/{series.episode_count}</Badge>
              </div>
              <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto text-sm">
                {series.episodes.map((e) => {
                  const active = e.asset_id === id
                  const epPct = e.duration_sec ? Math.min(100, (e.position_sec / e.duration_sec) * 100) : 0
                  return (
                    <div
                      key={e.asset_id}
                      className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5 transition', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                      onClick={() => { if (!active) switchEpisode(e.asset_id) }}
                    >
                      <span className={cn('w-6 text-center text-xs', active ? 'font-bold text-brand-600' : e.position_sec > 0 ? 'text-emerald-500' : 'text-slate-300')}>
                        {e.episode ?? '·'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={cn('truncate', active && 'font-medium')}>{e.title}</div>
                        {epPct > 0 && epPct < 100 && (
                          <div className="mt-1 h-1 rounded-full bg-slate-200"><div className="h-1 rounded-full bg-brand-500" style={{ width: `${epPct}%` }} /></div>
                        )}
                      </div>
                      <span className="font-mono text-xs text-slate-400">{fmtTime(e.duration_sec)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <ShareDialog assetId={video.id} assetTitle={video.title} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}


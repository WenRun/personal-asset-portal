import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppWindow, Download, Link2, Maximize, Minimize,
  Pause, Pencil, PictureInPicture2, Play, SkipForward, Star, Trash2, Volume2, VolumeX,
} from 'lucide-react'
import { api, API_BASE } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { BackLink, Badge, Button, HueCover } from '@/components/ui'
import { ShareDialog } from '@/components/ShareDialog'
import { DeleteAssetDialog } from '@/components/DeleteAssetDialog'
import { EditAssetDialog } from '@/components/EditAssetDialog'
import { cn, fmtDate, fmtTime } from '@/lib/utils'

/** 视频详情（§5.3）：Direct Play <video> 真实播放 + 观看进度云端同步 + 全屏/网页全屏/画中画/倍速/音量控制 + 系列集数平滑切换 */
export function VideoDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const user = useAuth((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const [editOpen, setEditOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const { data: video, isLoading: videoLoading } = useQuery({
    queryKey: ['video', id],
    queryFn: () => api.video(id!),
    enabled: !!id,
    placeholderData: (previousData) => previousData,
  })
  const { data: progress } = useQuery({
    queryKey: ['progress', id],
    queryFn: () => api.getProgress(id!),
    enabled: !!id,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [coverFail, setCoverFail] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const autoPlayNextRef = useRef(false)
  const restoredIdRef = useRef<string | null>(null)

  // 评分状态与操作
  const [rating, setRating] = useState<number>(0)
  const [hoverRating, setHoverRating] = useState<number>(0)
  const [isRatingSaving, setIsRatingSaving] = useState(false)

  useEffect(() => {
    if (typeof video?.rating === 'number') {
      setRating(video.rating)
    }
  }, [video?.rating])

  // 播放器状态（参考 B 站体验）
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isWebFullscreen, setIsWebFullscreen] = useState(false)
  const [isPip, setIsPip] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [toastText, setToastText] = useState<string | null>(null)
  const [scrubHover, setScrubHover] = useState<{ time: number; pct: number } | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  // 系列集数：使用 useQuery 缓存系列列表，切集时 sidebar 常驻无闪烁
  const seriesId = video?.series_id
  const { data: series } = useQuery({
    queryKey: ['video-series-episodes', seriesId],
    queryFn: () => api.seriesEpisodes(seriesId!),
    enabled: !!seriesId && video?.kind === 'tutorial',
    staleTime: 60_000,
  })

  const savedSec = typeof progress?.position?.seconds === 'number' ? progress.position.seconds : 0
  const durationSec = video?.durationSec ?? 0

  const nextEpisode = useMemo(() => {
    if (!series || video?.kind !== 'tutorial') return null
    const idx = series.episodes.findIndex((e) => e.asset_id === id)
    if (idx >= 0 && idx + 1 < series.episodes.length) {
      return series.episodes[idx + 1]
    }
    return null
  }, [series, video, id])

  const showToast = (text: string) => {
    setToastText(text)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastText(null), 1200)
  }

  // 控制栏静止自动渐隐
  const resetHideTimer = () => {
    setControlsVisible(true)
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    if (playing) {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
      }, 2500)
    }
  }

  // 播放/暂停
  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      showToast('播放')
    } else {
      v.pause()
      setPlaying(false)
      setControlsVisible(true)
      showToast('暂停')
    }
  }

  // 全屏切换（系统全屏）
  const toggleFullscreen = async () => {
    const c = containerRef.current
    if (!c) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        showToast('退出全屏')
      } else {
        await c.requestFullscreen()
        showToast('全屏')
      }
    } catch (e) {
      console.warn('Fullscreen toggle failed', e)
    }
  }

  // 网页全屏切换（在浏览器视口内铺满，不影响切标签或看控制台）
  const toggleWebFullscreen = () => {
    setIsWebFullscreen((prev) => {
      const next = !prev
      showToast(next ? '网页全屏' : '退出网页全屏')
      return next
    })
  }

  // 画中画切换
  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        showToast('退出画中画')
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture()
        showToast('画中画')
      }
    } catch (e) {
      console.warn('PiP error', e)
    }
  }

  // 音量调节
  const changeVolume = (val: number) => {
    const v = videoRef.current
    if (!v) return
    const clamped = Math.max(0, Math.min(1, +val.toFixed(2)))
    v.volume = clamped
    setVolume(clamped)
    if (clamped === 0) {
      v.muted = true
      setMuted(true)
      showToast('静音')
    } else {
      if (v.muted) v.muted = false
      setMuted(false)
      showToast(`音量 ${Math.round(clamped * 100)}%`)
    }
  }

  // 静音切换
  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    if (muted || v.volume === 0) {
      v.muted = false
      if (volume === 0) {
        v.volume = 0.5
        setVolume(0.5)
      }
      setMuted(false)
      showToast(`音量 ${Math.round(v.volume * 100)}%`)
    } else {
      v.muted = true
      setMuted(true)
      showToast('静音')
    }
  }

  // 倍速调节
  const changeRate = (r: number) => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = r
    setRate(r)
    showToast(`倍速 ${r}x`)
  }

  // 快进 / 快退
  const seekDelta = (delta: number) => {
    const v = videoRef.current
    if (!v || !durationSec) return
    const target = Math.max(0, Math.min(durationSec, v.currentTime + delta))
    v.currentTime = target
    setPos(target)
    showToast(delta > 0 ? `快进 +${delta}s` : `快退 ${delta}s`)
  }

  // 视频切集：SPA 无感路由切换，保存上一集进度并标记连播
  const switchEpisode = (assetId: string, autoPlay = true) => {
    const v = videoRef.current
    if (v && id) {
      void api.saveProgress(id, { seconds: v.currentTime })
    }
    autoPlayNextRef.current = autoPlay
    setPlaying(false)
    setPos(0)
    setCoverFail(false)
    restoredIdRef.current = null
    nav(`/videos/${assetId}`)
  }

  // 评分操作：点击保存，再次点击同星级可取消
  const handleRate = async (val: number) => {
    if (!id) return
    if (!user) {
      showToast('请登录后再评分')
      return
    }
    const next = rating === val ? 0 : val
    setRating(next)
    setIsRatingSaving(true)
    try {
      await api.patchAsset(id, { rating: next })
      showToast(next > 0 ? `已评分: ${next} 星` : '已取消评分')
      void qc.invalidateQueries({ queryKey: ['video', id] })
      void qc.invalidateQueries({ queryKey: ['videos'] })
    } catch (e) {
      console.error('Rate video failed', e)
      showToast('评分保存失败')
      setRating(video?.rating ?? 0)
    } finally {
      setIsRatingSaving(false)
    }
  }

  // 网页全屏时锁定 body 滚动
  useEffect(() => {
    if (isWebFullscreen) {
      const original = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = original
      }
    }
  }, [isWebFullscreen])

  // 监听原生全屏状态变更
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // 监听画中画事件
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onEnter = () => setIsPip(true)
    const onLeave = () => setIsPip(false)
    v.addEventListener('enterpictureinpicture', onEnter)
    v.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter)
      v.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [video])

  // 点击外部关闭倍速浮层
  useEffect(() => {
    if (!speedOpen) return
    const closeMenu = () => setSpeedOpen(false)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [speedOpen])

  // 键盘快捷键（参考 B 站：空格暂停、F 全屏、W 网页全屏、P 画中画、M 静音、左右快进退、上下音量）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return

      const key = e.key.toLowerCase()
      if (e.code === 'Space' || key === 'k') {
        e.preventDefault()
        toggle()
        resetHideTimer()
      } else if (key === 'f') {
        e.preventDefault()
        void toggleFullscreen()
      } else if (key === 'w') {
        e.preventDefault()
        toggleWebFullscreen()
      } else if (key === 'p') {
        e.preventDefault()
        void togglePip()
      } else if (key === 'm') {
        e.preventDefault()
        toggleMute()
      } else if (e.key === 'ArrowRight' || key === 'l') {
        e.preventDefault()
        seekDelta(5)
        resetHideTimer()
      } else if (e.key === 'ArrowLeft' || key === 'j') {
        e.preventDefault()
        seekDelta(-5)
        resetHideTimer()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        changeVolume(volume + 0.1)
        resetHideTimer()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        changeVolume(volume - 0.1)
        resetHideTimer()
      } else if (e.key === 'Escape') {
        if (isWebFullscreen) {
          e.preventDefault()
          setIsWebFullscreen(false)
          showToast('退出网页全屏')
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isWebFullscreen, volume, muted, durationSec, playing])

  // 视频元数据就绪后：恢复上次观看进度，若标记了自动连播则平滑起播
  const onLoadedMetadata = () => {
    const v = videoRef.current
    if (!v || !id) return
    v.volume = volume
    v.playbackRate = rate
    if (restoredIdRef.current !== id && typeof savedSec === 'number' && savedSec > 5) {
      if (savedSec < (durationSec || Infinity) - 5) {
        v.currentTime = savedSec
        setPos(savedSec)
      }
      restoredIdRef.current = id
    }
    if (autoPlayNextRef.current) {
      autoPlayNextRef.current = false
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }

  // 挂载恢复进度 + 播放器事件（真实播放：timeupdate 驱动，5s 节流上报）
  useEffect(() => {
    const v = videoRef.current
    if (!v || !id) return
    if (restoredIdRef.current !== id && typeof savedSec === 'number' && savedSec > 5) {
      if (savedSec < (durationSec || Infinity) - 5) {
        v.currentTime = savedSec
        setPos(savedSec)
      }
      restoredIdRef.current = id
    }
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
    const onEnded = () => {
      setPlaying(false)
      void api.saveProgress(id, { seconds: 0 })
      // 系列连播：本集播完自动切下一集
      if (series && video?.kind === 'tutorial') {
        const idx = series.episodes.findIndex((e) => e.asset_id === id)
        if (idx >= 0 && idx + 1 < series.episodes.length) {
          switchEpisode(series.episodes[idx + 1].asset_id, true)
        }
      }
    }
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
  }, [id, video, progress, series])

  if (!video && videoLoading) return <div className="p-6 text-slate-400">加载中…</div>
  if (!video) return <div className="p-6 text-slate-400">视频不存在或已被删除</div>

  const resume = savedSec > 5 && pos === 0
  const pct = durationSec ? (pos / durationSec) * 100 : 0
  const isClip = video.kind === 'clip'

  return (
    <div className="p-4 md:p-6">
      {/* 顶栏：左侧返回“视频墙”，右侧操作按钮组 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink to="/videos">视频墙</BackLink>
        <div className="flex flex-wrap items-center gap-2">
          {video.playable ? (
            <Button onClick={toggle}>{playing ? '暂停' : '播放'}</Button>
          ) : (
            <Button disabled>仅下载（不支持在线播放）</Button>
          )}
          <a href={api.downloadUrl(video.id)}>
            <Button variant="outline">下载{isClip ? '视频' : '本集'}</Button>
          </a>
          {/* 5 颗黄色小星星评分组件（悬停高亮 + 点击保存） */}
          <div
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm shadow-sm transition hover:border-slate-300"
            onMouseLeave={() => setHoverRating(0)}
            title={rating > 0 ? `当前评分: ${rating} 星 (再次点击同星级可取消)` : '点击星星评分 (1-5星)'}
          >
            <span className="text-xs font-medium text-slate-400 select-none">评分</span>
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  disabled={isRatingSaving}
                  onMouseEnter={() => setHoverRating(star)}
                  onClick={() => void handleRate(star)}
                  className="p-0.5 transition-transform hover:scale-125 focus:outline-none disabled:opacity-60"
                  title={`${star} 星`}
                >
                  <Star
                    className={cn(
                      'h-4 w-4 transition-colors',
                      star <= (hoverRating || rating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'fill-transparent text-slate-300 hover:text-amber-300',
                    )}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <span className="ml-0.5 font-mono text-xs font-bold text-amber-500">{rating}.0</span>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (!isAdmin) {
                showToast('只有管理员可以编辑资产元数据')
                return
              }
              setEditOpen(true)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />编辑
          </Button>
          {isAdmin && (
            <Button variant="outline" onClick={() => setShareOpen(true)}>
              <Link2 className="h-3.5 w-3.5" />分享
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" className="text-rose-600 hover:bg-rose-50" onClick={() => setDelOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />删除
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          {/* Direct Play：真实 <video>（Range 流）；不支持时占位 + 仅下载 */}
          {video.playable ? (
            <div
              ref={containerRef}
              onMouseMove={resetHideTimer}
              onMouseLeave={() => { if (playing) setControlsVisible(false) }}
              className={cn(
                'relative overflow-hidden bg-black select-none group/player transition-all',
                isWebFullscreen
                  ? 'fixed inset-0 z-50 flex items-center justify-center h-screen w-screen rounded-none'
                  : isFullscreen
                  ? 'flex items-center justify-center h-screen w-screen'
                  : 'rounded-xl shadow aspect-video',
                !controlsVisible && playing && 'cursor-none',
              )}
            >
              {coverFail && !playing ? (
                <HueCover hue={video.hue} className="aspect-video" />
              ) : (
                <video
                  key={video.id}
                  ref={videoRef}
                  src={api.videoStreamUrl(video.id)}
                  poster={video.cover_url ? API_BASE + video.cover_url : undefined}
                  className={cn(
                    'w-full transition-all object-contain',
                    isWebFullscreen || isFullscreen ? 'h-full max-h-screen' : 'aspect-video',
                  )}
                  onClick={toggle}
                  onDoubleClick={toggleFullscreen}
                  onLoadedMetadata={onLoadedMetadata}
                  onError={() => setCoverFail(true)}
                  controls={false}
                />
              )}

              {/* 快捷操作反馈 Toast（居中顶置） */}
              {toastText && (
                <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 pointer-events-none rounded-lg bg-black/80 backdrop-blur px-4 py-2 text-xs font-semibold text-white shadow-2xl border border-white/10 flex items-center gap-2">
                  {toastText}
                </div>
              )}

              {/* 网页全屏时的退出快捷按钮 */}
              {isWebFullscreen && (
                <button
                  onClick={toggleWebFullscreen}
                  className={cn(
                    'absolute top-4 right-4 z-20 flex items-center gap-1.5 rounded-lg bg-black/60 hover:bg-black/80 px-3 py-1.5 text-xs text-white backdrop-blur border border-white/10 transition',
                    !controlsVisible && playing && 'opacity-0 pointer-events-none',
                  )}
                  title="退出网页全屏 (Esc)"
                >
                  <AppWindow className="h-3.5 w-3.5" />
                  退出网页全屏
                </button>
              )}

              {/* 画面中央暂停大按钮 */}
              {!playing && !coverFail && (
                <button
                  className="absolute inset-0 grid place-items-center z-10"
                  onClick={() => {
                    const v = videoRef.current
                    if (v) {
                      if (savedSec > 5 && v.currentTime < 1) v.currentTime = savedSec
                      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
                    }
                  }}
                >
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-600/90 text-white shadow-2xl transition hover:scale-110">
                    <Play className="ml-1 h-7 w-7" fill="currentColor" />
                  </span>
                </button>
              )}

              {resume && !playing && (
                <div className="absolute left-3 top-3 z-10 rounded-md bg-black/70 px-2.5 py-1 text-xs text-white backdrop-blur">
                  上次看到 {fmtTime(savedSec)} · 点击续播
                </div>
              )}

              {/* 底部控制栏：参考哔哩哔哩（鼠标静止自动隐藏、进度条 hover 预览、倍速、音量滑动、画中画、网页全屏、全屏） */}
              <div
                onMouseEnter={() => {
                  if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
                  setControlsVisible(true)
                }}
                onMouseLeave={() => {
                  resetHideTimer()
                }}
                className={cn(
                  'absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pb-3 pt-12 transition-opacity duration-300',
                  !controlsVisible && playing ? 'opacity-0 pointer-events-none' : 'opacity-100',
                )}
              >
                {/* 进度条轨道（hover 增粗 + 浮动时间提示框） */}
                <div
                  className="relative mb-2.5 py-1.5 cursor-pointer group/progress"
                  onMouseMove={(e) => {
                    if (!durationSec) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                    setScrubHover({ time: ratio * durationSec, pct: ratio * 100 })
                  }}
                  onMouseLeave={() => setScrubHover(null)}
                  onClick={(e) => {
                    const v = videoRef.current
                    if (!v || !durationSec) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                    const target = ratio * durationSec
                    v.currentTime = target
                    setPos(target)
                  }}
                >
                  {/* 悬浮时间提示 */}
                  {scrubHover && (
                    <div
                      className="absolute -top-7 -translate-x-1/2 pointer-events-none rounded bg-black/85 px-2 py-0.5 text-[10px] font-mono text-white shadow-lg backdrop-blur border border-white/10"
                      style={{ left: `${scrubHover.pct}%` }}
                    >
                      {fmtTime(scrubHover.time)}
                    </div>
                  )}
                  {/* 进度轨道 */}
                  <div className="h-1 group-hover/progress:h-2 rounded-full bg-white/20 transition-all overflow-hidden relative">
                    <div className="h-full bg-brand-500 rounded-full transition-none" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* 控制条按钮组 */}
                <div className="flex items-center gap-3 text-xs text-white">
                  {/* 左侧：播放/暂停、下一集、时间 */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggle}
                      title={playing ? '暂停 (Space)' : '播放 (Space)'}
                      className="p-1 rounded text-white/90 hover:text-white transition hover:bg-white/10"
                    >
                      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" fill="currentColor" />}
                    </button>
                    {nextEpisode && (
                      <button
                        onClick={() => switchEpisode(nextEpisode.asset_id, true)}
                        title={`下一集: ${nextEpisode.title}`}
                        className="p-1 rounded text-white/90 hover:text-white transition hover:bg-white/10"
                      >
                        <SkipForward className="h-4 w-4" />
                      </button>
                    )}
                    <span className="font-mono text-xs text-white/90 select-none ml-1">
                      {fmtTime(pos)} / {fmtTime(durationSec)}
                    </span>
                  </div>

                  {/* 右侧功能组：清晰度信息、倍速、音量、画中画、网页全屏、全屏 */}
                  <div className="ml-auto flex items-center gap-3">
                    {/* 清晰度与编码 */}
                    {(video.resolution || video.codec) && (
                      <span className="hidden sm:inline text-white/50 text-[11px] font-mono">
                        {[video.resolution, video.codec, 'Direct Play'].filter(Boolean).join(' · ')}
                      </span>
                    )}

                    {/* 倍速选择菜单（支持悬停呼出与点击固定，带连贯触控区域） */}
                    <div
                      className="relative group/speed py-1"
                      onMouseEnter={() => {
                        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
                        setControlsVisible(true)
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSpeedOpen((prev) => !prev)
                        }}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs font-medium text-white/90 hover:bg-white/15 transition select-none',
                          (speedOpen || rate !== 1) && 'text-brand-400 bg-white/10 font-bold',
                        )}
                        title="播放倍速（点击或悬停切换）"
                      >
                        {rate === 1 ? '倍速' : `${rate}x`}
                      </button>

                      {/* 浮层面板：用 pb-2 作为连贯的触控桥，消除按钮与选项间的悬停盲区 */}
                      <div
                        className={cn(
                          'absolute bottom-full left-1/2 -translate-x-1/2 pb-2 z-30',
                          speedOpen ? 'block' : 'hidden group-hover/speed:block',
                        )}
                      >
                        <div className="flex flex-col bg-slate-900/95 backdrop-blur-md rounded-lg py-1 px-1 shadow-2xl border border-white/10 min-w-[64px]">
                          {[2.0, 1.5, 1.25, 1.0, 0.75, 0.5].map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                changeRate(r)
                                setSpeedOpen(false)
                              }}
                              className={cn(
                                'px-2.5 py-1 text-xs rounded text-center transition hover:bg-white/20',
                                rate === r ? 'text-brand-400 font-bold bg-white/10' : 'text-white/80',
                              )}
                            >
                              {r}x
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 音量控制（hover 滑动条） */}
                    <div className="flex items-center group/vol py-1">
                      <button
                        onClick={toggleMute}
                        title={muted ? '取消静音 (M)' : '静音 (M)'}
                        className="p-1 rounded text-white/90 hover:text-white transition hover:bg-white/10"
                      >
                        {muted || volume === 0 ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
                      </button>
                      <div className="w-0 overflow-hidden group-hover/vol:w-16 transition-all duration-200 flex items-center pl-1">
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={muted ? 0 : volume}
                          onChange={(e) => changeVolume(+e.target.value)}
                          className="w-16 h-1 accent-brand-500 bg-white/30 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* 画中画 */}
                    <button
                      onClick={togglePip}
                      title={isPip ? '退出画中画 (P)' : '画中画 (P)'}
                      className={cn(
                        'p-1 rounded text-white/90 hover:text-white transition hover:bg-white/10',
                        isPip && 'text-brand-400 bg-white/15',
                      )}
                    >
                      <PictureInPicture2 className="h-4 w-4" />
                    </button>

                    {/* 网页全屏 */}
                    <button
                      onClick={toggleWebFullscreen}
                      title={isWebFullscreen ? '退出网页全屏 (W / Esc)' : '网页全屏 (W)'}
                      className={cn(
                        'p-1 rounded text-white/90 hover:text-white transition hover:bg-white/10',
                        isWebFullscreen && 'text-brand-400 bg-white/15',
                      )}
                    >
                      <AppWindow className="h-4 w-4" />
                    </button>

                    {/* 系统全屏 */}
                    <button
                      onClick={toggleFullscreen}
                      title={isFullscreen ? '退出全屏 (F)' : '全屏 (F)'}
                      className="p-1 rounded text-white/90 hover:text-white transition hover:bg-white/10"
                    >
                      {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </button>
                  </div>
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
              {rating > 0 && <Badge tone="amber">★ {rating}.0</Badge>}
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

      <EditAssetDialog
        assetId={video.id}
        initialTitle={video.title}
        initialNote={video.note || ''}
        initialTags={video.tags || []}
        initialRating={rating}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={() => {
          showToast('资产信息已更新')
        }}
      />
      <ShareDialog assetId={video.id} assetTitle={video.title} open={shareOpen} onClose={() => setShareOpen(false)} />
      <DeleteAssetDialog assetId={video.id} assetTitle={video.title} listPath="/videos" open={delOpen} onClose={() => setDelOpen(false)} />
    </div>
  )
}


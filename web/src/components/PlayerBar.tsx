import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { List, Mic2, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { cn, fmtTime } from '@/lib/utils'
import { usePlayer } from '@/stores/player'
import { api } from '@/api/client'
import { HueCover } from '@/components/ui'

interface LyricLine { time: number | null; text: string }

/** 解析歌词：LRC 时间轴行（支持一行多时间戳）→ 按时间排序；无时间戳则整体按纯文本展示。 */
function parseLyrics(raw: string): LyricLine[] {
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  // [ti:]/[ar:] 等 ID3 元数据标签行不作为歌词正文
  const metaRe = /^\[(ti|ar|al|by|au|re|ve|offset|length|hash|encoding):/i
  const lines: LyricLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (metaRe.test(line.trim())) continue
    const stamps: number[] = []
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac)
    }
    const text = line.replace(re, '').trim()
    if (stamps.length === 0) {
      if (text) lines.push({ time: null, text })
      continue
    }
    for (const t of stamps) lines.push({ time: t, text })
  }
  if (lines.some((l) => l.time != null)) {
    return lines.filter((l) => l.time != null || l.text).sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  }
  return lines
}

/** 全局播放条（§7.4 PlayerBar）：真实 <audio> Range 流播放（/api/music/{id}/stream），跨页不中断。 */
export function PlayerBar() {
  const { queue, index, playing, volume, albumTitle, artist, toggle, next, prev, setVolume, setPlaying } = usePlayer()
  const cur = queue[index]
  const audioRef = useRef<HTMLAudioElement>(null)
  const [pos, setPos] = useState(0)
  const [showLyrics, setShowLyrics] = useState(false)
  const lyricBoxRef = useRef<HTMLDivElement>(null)

  // 切曲 → 换源并播放
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !cur) return
    audio.src = api.musicStreamUrl(cur.id)
    audio.load()
    if (playing) void audio.play().catch(() => setPlaying(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id])

  // 播放/暂停同步
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !cur) return
    if (playing && audio.paused) void audio.play().catch(() => setPlaying(false))
    if (!playing && !audio.paused) audio.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  // 歌词（打开面板且当前曲目带歌词时拉取）
  const { data: lyricData } = useQuery({
    queryKey: ['lyrics', cur?.id],
    queryFn: () => api.lyrics(cur!.id),
    enabled: showLyrics && !!cur,
  })
  const lyricLines = useMemo(() => (lyricData?.lyrics ? parseLyrics(lyricData.lyrics) : []), [lyricData])
  const lyricTimed = lyricLines.some((l) => l.time != null)
  const activeLine = useMemo(() => {
    if (!lyricTimed) return -1
    let idx = -1
    for (let i = 0; i < lyricLines.length; i++) {
      const t = lyricLines[i].time
      if (t != null && t <= pos) idx = i
    }
    return idx
  }, [lyricLines, lyricTimed, pos])

  // 当前歌词行滚动到面板中部
  useEffect(() => {
    const box = lyricBoxRef.current
    if (!box || !showLyrics) return
    const el = box.querySelector('[data-active="true"]') as HTMLElement | null
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
    else box.scrollTo({ top: 0 })
  }, [activeLine, showLyrics])

  if (!cur) return null
  const audioDur = audioRef.current?.duration
  const duration = audioDur && Number.isFinite(audioDur) ? audioDur : cur.durationSec
  const pct = duration ? (pos / duration) * 100 : 0

  const seekTo = (t: number) => {
    const audio = audioRef.current
    if (audio && Number.isFinite(t)) {
      audio.currentTime = t
      setPos(t)
    }
  }

  return (
    <footer className="relative z-30 flex h-16 shrink-0 animate-rise items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 text-slate-300">
      <audio
        ref={audioRef}

        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onEnded={() => { setPos(0); next() }}
        onError={() => { if (queue.length > 1) next() }}
        onPlay={() => !playing && setPlaying(true)}
        onPause={() => playing && setPlaying(false)}
      />

      {/* 歌词面板（有歌词的曲目可展开；LRC 时间轴高亮 + 点击跳播） */}
      {showLyrics && (
        <div className="absolute inset-x-0 bottom-16 mx-auto max-h-[46vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-b-0 border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
            <span>歌词{lyricTimed ? ' · 同步滚动' : ''}</span>
            <span className="truncate pl-4 text-slate-600">{cur.title}</span>
          </div>
          <div ref={lyricBoxRef} className="max-h-[calc(46vh-3rem)] overflow-y-auto">
            {lyricLines.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                {lyricData ? '没有可用歌词' : '歌词加载中…'}
              </div>
            ) : (
              <div className="space-y-3 py-4 text-center text-sm leading-6">
                {lyricLines.map((l, i) => (
                  <div
                    key={`${i}-${l.time ?? 'x'}`}
                    data-active={lyricTimed && i === activeLine ? 'true' : undefined}
                    className={cn(
                      'transition',
                      lyricTimed
                        ? i === activeLine
                          ? 'cursor-pointer text-base font-medium text-brand-300'
                          : 'cursor-pointer text-slate-500 hover:text-slate-300'
                        : 'text-slate-400',
                    )}
                    onClick={lyricTimed && l.time != null ? () => seekTo(l.time!) : undefined}
                  >
                    {l.text || '♪'}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <HueCover hue={245} className="h-10 w-10 shrink-0 rounded-md" />
      <div className="hidden w-44 min-w-0 sm:block">
        <div className="truncate text-sm text-white">{cur.title}</div>
        <div className="truncate text-xs text-slate-500">{artist} · {albumTitle}</div>
      </div>
      <div className="flex items-center gap-3">
        <button className="text-slate-400 hover:text-white" onClick={prev}><SkipBack className="h-4 w-4" fill="currentColor" /></button>
        <button
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-900 transition hover:scale-105"
          onClick={toggle}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>
        <button className="text-slate-400 hover:text-white" onClick={next}><SkipForward className="h-4 w-4" fill="currentColor" /></button>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[10px] text-slate-500">
        <span>{fmtTime(pos)}</span>
        <div
          className="group h-1 min-w-8 flex-1 cursor-pointer rounded-full bg-slate-700"
          onClick={(e) => {
            const rect = (e.target as HTMLElement).getBoundingClientRect()
            const audio = audioRef.current
            if (audio && duration) {
              audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration
            }
          }}
        >
          <div className="relative h-1 rounded-full bg-brand-500" style={{ width: `${Math.min(100, pct)}%` }}>
            <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white opacity-0 transition group-hover:opacity-100" />
          </div>
        </div>
        <span>{fmtTime(duration)}</span>
      </div>
      <div className="hidden w-28 items-center gap-2 md:flex">
        <Volume2 className="h-4 w-4 text-slate-400" />
        <input
          type="range" min={0} max={100} value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="w-full accent-brand-500"
        />
      </div>
      {cur.lrc && (
        <button
          className={cn('hidden text-slate-400 hover:text-white lg:block', showLyrics && 'text-brand-400')}
          title="歌词"
          onClick={() => setShowLyrics((v) => !v)}
        >
          <Mic2 className="h-4 w-4" />
        </button>
      )}
      <button className="hidden text-slate-400 hover:text-white lg:block"><List className="h-4 w-4" /></button>
    </footer>
  )
}

export function PlayBadge({ playing }: { playing: boolean }) {
  return playing ? (
    <span className="inline-flex h-3 items-end gap-0.5 align-middle">
      {[60, 100, 40].map((h, i) => (
        <i key={i} className={cn('w-0.5 origin-bottom rounded bg-brand-500 animate-eq')} style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  ) : null
}

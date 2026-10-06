import { useEffect, useRef, useState } from 'react'
import { List, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { cn, fmtTime } from '@/lib/utils'
import { usePlayer } from '@/stores/player'
import { api } from '@/api/client'
import { HueCover } from '@/components/ui'

/** 全局播放条（§7.4 PlayerBar）：真实 <audio> Range 流播放（/api/music/{id}/stream），跨页不中断。 */
export function PlayerBar() {
  const { queue, index, playing, volume, albumTitle, artist, toggle, next, prev, setVolume, setPlaying } = usePlayer()
  const cur = queue[index]
  const audioRef = useRef<HTMLAudioElement>(null)
  const [pos, setPos] = useState(0)

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

  if (!cur) return null
  const audioDur = audioRef.current?.duration
  const duration = audioDur && Number.isFinite(audioDur) ? audioDur : cur.durationSec
  const pct = duration ? (pos / duration) * 100 : 0

  return (
    <footer className="z-30 flex h-16 shrink-0 animate-rise items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 text-slate-300">
      <audio
        ref={audioRef}

        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onEnded={() => { setPos(0); next() }}
        onError={() => { if (queue.length > 1) next() }}
        onPlay={() => !playing && setPlaying(true)}
        onPause={() => playing && setPlaying(false)}
      />
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

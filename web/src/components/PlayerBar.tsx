import { useEffect } from 'react'
import { List, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { cn, fmtTime } from '@/lib/utils'
import { usePlayer } from '@/stores/player'
import { HueCover } from '@/components/ui'

/** 全局播放条：挂在 AppShell，跨页不中断（详细设计 §7.4 PlayerBar）。播放为 mock 计时。 */
export function PlayerBar() {
  const { queue, index, playing, pos, volume, albumTitle, artist, toggle, next, prev, seek, setVolume } = usePlayer()
  const cur = queue[index]

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const s = usePlayer.getState()
      if (!s.playing) return
      const track = s.queue[s.index]
      if (!track) return
      if (s.pos + 1 >= track.durationSec) usePlayer.getState().next()
      else usePlayer.setState({ pos: s.pos + 1 })
    }, 1000)
    return () => clearInterval(t)
  }, [playing, index])

  if (!cur) return null
  const pct = (pos / cur.durationSec) * 100

  return (
    <footer className="z-30 flex h-16 shrink-0 animate-rise items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 text-slate-300">
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
            seek((e.clientX - rect.left) / rect.width)
          }}
        >
          <div className="relative h-1 rounded-full bg-brand-500" style={{ width: `${pct}%` }}>
            <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white opacity-0 transition group-hover:opacity-100" />
          </div>
        </div>
        <span>{fmtTime(cur.durationSec)}</span>
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

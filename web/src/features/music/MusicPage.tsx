import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { api } from '@/api/client'
import { usePlayer } from '@/stores/player'
import { useAssetNav, Badge, Chip, EqBars, HueCover, PageHeader } from '@/components/ui'
import { fmtTime } from '@/lib/utils'
import type { Album } from '@/types'

type View = 'album' | 'artist' | 'tracks'
type Sort = 'recent' | 'artist' | 'year'

const VIEWS: { key: View; label: string }[] = [
  { key: 'album', label: '专辑墙' },
  { key: 'artist', label: '艺术家' },
  { key: 'tracks', label: '全部曲目' },
]

export function MusicPage() {
  const { data: albums } = useQuery({ queryKey: ['albums'], queryFn: api.albums })
  const playAlbum = usePlayer((s) => s.playAlbum)
  const nav = useAssetNav()
  const { queue, index, playing, albumId: curAlbumId } = usePlayer()
  const [view, setView] = useState<View>('album')
  const [sort, setSort] = useState<Sort>('recent')
  const [filter, setFilter] = useState<'all' | 'FLAC' | 'MP3' | 'fav'>('all')

  const filtered = useMemo(() => {
    const arr = albums ?? []
    if (filter === 'FLAC' || filter === 'MP3') return arr.filter((a) => a.format === filter)
    if (filter === 'fav') return arr.filter((a) => a.favorite)
    return arr
  }, [albums, filter])

  const list = useMemo(() => {
    const arr = [...filtered]
    if (sort === 'recent') arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (sort === 'artist') arr.sort((a, b) => a.artist.localeCompare(b.artist, 'zh-Hans-CN'))
    if (sort === 'year') arr.sort((a, b) => b.year - a.year)
    return arr
  }, [filtered, sort])

  const byArtist = useMemo(() => {
    const map = new Map<string, Album[]>()
    for (const a of list) {
      const artist = a.artist || "未知艺术家"
      if (!map.has(artist)) map.set(artist, [])
      map.get(artist)!.push(a)
    }
    return [...map.entries()]
  }, [list])

  // 全部曲目视图：跨专辑平铺（点击行播放所在专辑的该曲）
  const allTracks = useMemo(() => list.flatMap((a) => a.tracks.map((t) => ({ t, a }))), [list])
  const curTrackId = queue[index]?.id

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="音乐"
        sub={`${albums?.length ?? 0} 个音频文件（专辑/曲目聚合随 M4 接入）`}
        right={
          <>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  className={`px-3 py-1.5 transition ${view === v.key ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                  onClick={() => setView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-brand-500"
              aria-label="排序"
            >
              <option value="recent">最近入库</option>
              <option value="artist">按艺术家</option>
              <option value="year">按年份</option>
            </select>
          </>
        }
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
        <Chip active={filter === 'FLAC'} onClick={() => setFilter('FLAC')}>FLAC 无损</Chip>
        <Chip active={filter === 'MP3'} onClick={() => setFilter('MP3')}>MP3</Chip>
        <Chip active={filter === 'fav'} onClick={() => setFilter('fav')}>★ 收藏</Chip>
      </div>

      {view === 'album' && (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          {list.map((a) => (
            <div key={a.id} className="group cursor-pointer" onClick={() => nav(`/music/albums/${a.id}`)}>
              <HueCover hue={a.hue} className="aspect-square rounded-xl shadow-sm transition group-hover:shadow-md">
                <div className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                  <button
                    className="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow"
                    onClick={(e) => { e.stopPropagation(); playAlbum(a) }}
                  >
                    <Play className="ml-0.5 h-5 w-5 text-brand-600" fill="currentColor" />
                  </button>
                </div>
                <span className="absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{a.format}</span>
              </HueCover>
              <div className="mt-2 truncate text-sm font-medium">{a.title}</div>
              <div className="truncate text-xs text-slate-400">{a.artist || "未知艺术家"} · {a.year} · {a.format}</div>
            </div>
          ))}
        </div>
      )}

      {view === 'artist' && (
        <div className="mt-4 space-y-4">
          {byArtist.map(([artist, arts]) => (
            <div key={artist} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-sm font-semibold">{artist} <span className="text-xs font-normal text-slate-400">{arts.length} 张专辑</span></div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {arts.map((a) => (
                  <div key={a.id} className="w-32 shrink-0 cursor-pointer" onClick={() => nav(`/music/albums/${a.id}`)}>
                    <HueCover hue={a.hue} className="aspect-square rounded-lg transition hover:opacity-90" />
                    <div className="mt-1.5 truncate text-xs font-medium">{a.title}</div>
                    <div className="truncate text-[10px] text-slate-400">{a.year}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'tracks' && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-400">
              <tr>
                <th className="w-10 px-4 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">标题</th>
                <th className="px-2 py-2 text-left font-medium">专辑</th>
                <th className="px-2 py-2 text-left font-medium">艺术家</th>
                <th className="w-16 px-2 py-2 text-left font-medium">格式</th>
                <th className="w-16 px-2 py-2 text-left font-medium">歌词</th>
                <th className="w-16 px-2 py-2 text-left font-medium">时长</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allTracks.map(({ t, a }, i) => {
                const active = curAlbumId === a.id && curTrackId === t.id
                return (
                  <tr
                    key={t.id}
                    className={`cursor-pointer transition ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                    onClick={() => playAlbum(a, t.no)}
                  >
                    <td className="px-4 py-2.5">
                      {active && playing ? <EqBars /> : <span className={active ? 'font-bold text-brand-600' : 'text-slate-400'}>{i + 1}</span>}
                    </td>
                    <td className={`px-2 py-2.5 font-medium ${active ? 'text-brand-700' : ''}`}>
                      {t.title}
                      {active && !playing && <span className="ml-2 text-xs text-slate-400">（已暂停）</span>}
                    </td>
                    <td className="px-2 py-2.5 text-slate-500">{a.title}</td>
                    <td className="px-2 py-2.5 text-slate-500">{a.artist}</td>
                    <td className="px-2 py-2.5"><Badge tone={a.format === 'FLAC' ? 'green' : 'slate'}>{a.format}</Badge></td>
                    <td className="px-2 py-2.5">{t.lrc ? <Badge tone="brand">LRC</Badge> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2.5 font-mono text-slate-400">{fmtTime(t.durationSec)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-400">
            共 {allTracks.length} 首（受当前筛选影响）· 点击任意行播放 · 排序跟随右上角选择框
          </div>
        </div>
      )}
    </div>
  )
}

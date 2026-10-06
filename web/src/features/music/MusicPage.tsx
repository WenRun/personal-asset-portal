import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { api } from '@/api/client'
import { usePlayer } from '@/stores/player'
import { useAssetNav, Badge, HueCover, PageHeader } from '@/components/ui'
import { fmtTime } from '@/lib/utils'

type View = 'album' | 'artist' | 'tracks'
type Sort = 'recent' | 'artist' | 'year'

const VIEWS: { key: View; label: string }[] = [
  { key: 'album', label: '专辑墙' },
  { key: 'artist', label: '艺术家' },
  { key: 'tracks', label: '全部曲目' },
]

function hueOf(id: string) {
  return id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
}

export function MusicPage() {
  const { data: albums } = useQuery({ queryKey: ['music-albums'], queryFn: api.musicAlbums })
  const playAlbum = usePlayer((s) => s.playAlbum)
  const nav = useAssetNav()
  const [view, setView] = useState<View>('album')
  const [sort, setSort] = useState<Sort>('recent')
  const [coverFail, setCoverFail] = useState<Record<string, boolean>>({})

  const sorted = useMemo(() => {
    const arr = [...(albums ?? [])]
    if (sort === 'recent') arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    if (sort === 'artist') arr.sort((a, b) => a.artist.localeCompare(b.artist, 'zh-Hans-CN'))
    if (sort === 'year') arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    return arr
  }, [albums, sort])

  const byArtist = useMemo(() => {
    const m = new Map<string, typeof sorted>()
    for (const a of sorted) {
      const artist = a.artist || '未知艺术家'
      if (!m.has(artist)) m.set(artist, [])
      m.get(artist)!.push(a)
    }
    return [...m.entries()]
  }, [sorted])

  const playAlbumById = async (id: string) => {
    const album = await api.album(id)
    if (album.tracks.length) playAlbum(album)
  }

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="音乐"
        sub={`${albums?.length ?? 0} 张专辑（mutagen 标签解析 · 真实音频流播放）`}
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

      {view === 'album' && (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          {sorted.map((a) => {
            const hue = hueOf(a.id)
            return (
              <div key={a.id} className="group cursor-pointer" onClick={() => nav(`/music/albums/${a.id}`)}>
                {!coverFail[a.id] && a.has_cover ? (
                  <div className="relative aspect-square overflow-hidden rounded-xl shadow-sm transition group-hover:shadow-md">
                    <img
                      src={api.musicAlbumCoverUrl(a.id, 256)}
                      alt={a.name}
                      className="h-full w-full object-cover"
                      onError={() => setCoverFail((f) => ({ ...f, [a.id]: true }))}
                    />
                    <div className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                      <button
                        className="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow"
                        onClick={(e) => { e.stopPropagation(); void playAlbumById(a.id) }}
                      >
                        <Play className="ml-0.5 h-5 w-5 text-brand-600" fill="currentColor" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <HueCover hue={hue} className="aspect-square rounded-xl shadow-sm">
                    <div className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                      <button
                        className="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow"
                        onClick={(e) => { e.stopPropagation(); void playAlbumById(a.id) }}
                      >
                        <Play className="ml-0.5 h-5 w-5 text-brand-600" fill="currentColor" />
                      </button>
                    </div>
                  </HueCover>
                )}
                <div className="mt-2 truncate text-sm font-medium">{a.name}</div>
                <div className="truncate text-xs text-slate-400">{a.artist} · {a.year ?? '—'} · {a.track_count} 首</div>
              </div>
            )
          })}
          {albums && sorted.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
              还没有专辑 —— 上传音频或让管理员扫描 music 目录
            </div>
          )}
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
                    <HueCover hue={hueOf(a.id)} className="aspect-square rounded-lg transition hover:opacity-90" />
                    <div className="mt-1.5 truncate text-xs font-medium">{a.name}</div>
                    <div className="truncate text-[10px] text-slate-400">{a.year ?? ''}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'tracks' && <TracksView />}
    </div>
  )
}

/** 全部曲目（member）：平铺表 + 点行播放（从所属专辑入队） */
function TracksView() {
  const { data: tracks } = useQuery({ queryKey: ['music-tracks'], queryFn: api.musicTracks })
  const playAlbum = usePlayer((s) => s.playAlbum)
  const { queue, index } = usePlayer()
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const arr = tracks ?? []
    const s = q.trim().toLowerCase()
    return s ? arr.filter((t) => `${t.title}${t.artist}${t.album}`.toLowerCase().includes(s)) : arr
  }, [tracks, q])

  const curTrackId = queue[index]?.id

  const play = async (assetId: string) => {
    const hit = (tracks ?? []).find((t) => t.asset_id === assetId)
    if (!hit || !hit.streamable) return
    const album = await api.album(hit.album_id)
    if (album.tracks.length) playAlbum(album, album.tracks.find((t) => t.id === assetId)?.no ?? 1)
  }

  return (
    <div className="mt-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="在曲目中过滤…"
        className="mb-3 w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-400">
            <tr>
              <th className="w-10 px-4 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">标题</th>
              <th className="px-2 py-2 text-left font-medium">专辑</th>
              <th className="px-2 py-2 text-left font-medium">艺术家</th>
              <th className="w-16 px-2 py-2 text-left font-medium">歌词</th>
              <th className="w-16 px-2 py-2 text-left font-medium">时长</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((t, i) => {
              const active = curTrackId === t.asset_id
              return (
                <tr key={t.asset_id} className={`cursor-pointer transition ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`} onClick={() => play(t.asset_id)}>
                  <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                  <td className={`px-2 py-2.5 font-medium ${active ? 'text-brand-700' : ''}`}>{t.title}</td>
                  <td className="px-2 py-2.5 text-slate-500">{t.album}</td>
                  <td className="px-2 py-2.5 text-slate-500">{t.artist}</td>
                  <td className="px-2 py-2.5">{t.lrc ? <Badge tone="brand">LRC</Badge> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-2 py-2.5 font-mono text-slate-400">{fmtTime(t.duration_sec)}</td>
                </tr>
              )
            })}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center text-slate-400">没有匹配的曲目</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-center text-xs text-slate-400">
        共 {list.length} 首 · 点行播放（/api/music/&#123;id&#125;/stream 真实音频流）
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { usePlayer } from '@/stores/player'

export function MusicTrackRedirect() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const playAlbum = usePlayer((s) => s.playAlbum)
  const { data: tracks, isLoading } = useQuery({ queryKey: ['music-tracks'], queryFn: api.musicTracks })

  useEffect(() => {
    if (isLoading || !id) return
    const track = tracks?.find((t) => t.asset_id === id)
    if (track) {
      void (async () => {
        try {
          const album = await api.album(track.album_id)
          if (album.tracks.length) {
            playAlbum(album, track.asset_id)
            nav(`/music/albums/${track.album_id}`, { replace: true })
            return
          }
        } catch {
          // ignore error
        }
        nav('/music', { replace: true })
      })()
    } else {
      nav('/music', { replace: true })
    }
  }, [id, tracks, isLoading, nav, playAlbum])

  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-400">
      正在加载并准备播放…
    </div>
  )
}

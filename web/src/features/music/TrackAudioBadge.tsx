import { cn } from '@/lib/utils'

interface TrackAudioBadgeProps {
  format?: string | null
  surround?: string | null
  channels?: number | null
  sampleRateHz?: number | null
  isCue?: boolean | null
  dark?: boolean
  className?: string
}

export function TrackAudioBadge({
  format,
  surround,
  channels,
  sampleRateHz,
  isCue = false,
  dark = false,
  className,
}: TrackAudioBadgeProps) {
  const fmt = format?.toLowerCase() || ''
  const isDsd = fmt === 'dsf' || fmt === 'dff' || (sampleRateHz != null && sampleRateHz >= 2800000)
  const isDts = fmt === 'dts' || fmt === 'dtshd'
  const isSurround = !isDts && (surround === '5.1' || surround === '7.1' || surround === '4.0' || channels === 6 || channels === 8)
  const isApe = fmt === 'ape'
  const isAiff = fmt === 'aiff' || fmt === 'aif'
  const isAlac = fmt === 'alac'
  const isOpus = fmt === 'opus'
  const isWma = fmt === 'wma'
  const isHiRes = !isDsd && (sampleRateHz != null && sampleRateHz >= 88200)

  if (!isDsd && !isDts && !isSurround && !isApe && !isAiff && !isAlac && !isOpus && !isWma && !isHiRes && !isCue) {
    return null
  }

  let label = ''
  let lightStyle = ''
  let darkStyle = ''

  if (isDsd) {
    if (sampleRateHz && sampleRateHz >= 5600000) label = 'DSD128 5.6MHz'
    else if (sampleRateHz && sampleRateHz >= 2800000) label = 'DSD64 2.8MHz'
    else label = fmt ? fmt.toUpperCase() : 'DSD'
    if (isCue) label += ' · CUE'
    lightStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200'
    darkStyle = 'bg-emerald-400/20 text-emerald-300 border-emerald-500/30'
  } else if (isDts) {
    label = surround === '7.1' || channels === 8 ? 'DTS 7.1' : (surround === '5.1' || channels === 6 ? 'DTS 5.1' : 'DTS')
    if (isCue) label += ' · CUE'
    lightStyle = 'bg-amber-50 text-amber-700 border-amber-200'
    darkStyle = 'bg-amber-400/20 text-amber-300 border-amber-500/30'
  } else if (isSurround) {
    label = surround ? `${surround} 环绕声` : (channels === 6 ? '5.1ch' : `${channels}ch`)
    if (isCue) label += ' · CUE'
    lightStyle = 'bg-amber-50 text-amber-700 border-amber-200'
    darkStyle = 'bg-amber-400/20 text-amber-300 border-amber-500/30'
  } else if (isApe) {
    label = isCue ? 'APE · CUE' : 'APE 无损'
    lightStyle = 'bg-blue-50 text-blue-700 border-blue-200'
    darkStyle = 'bg-blue-400/20 text-blue-300 border-blue-500/30'
  } else if (isAiff) {
    label = isCue ? 'AIFF · CUE' : 'AIFF 无损'
    lightStyle = 'bg-sky-50 text-sky-700 border-sky-200'
    darkStyle = 'bg-sky-400/20 text-sky-300 border-sky-500/30'
  } else if (isAlac) {
    label = isCue ? 'ALAC · CUE' : 'ALAC 无损'
    lightStyle = 'bg-indigo-50 text-indigo-700 border-indigo-200'
    darkStyle = 'bg-indigo-400/20 text-indigo-300 border-indigo-500/30'
  } else if (isOpus) {
    label = isCue ? 'Opus · CUE' : 'Opus'
    lightStyle = 'bg-teal-50 text-teal-700 border-teal-200'
    darkStyle = 'bg-teal-400/20 text-teal-300 border-teal-500/30'
  } else if (isHiRes) {
    label = `Hi-Res ${Math.round((sampleRateHz! / 1000) * 10) / 10}kHz`
    if (isCue) label += ' · CUE'
    lightStyle = 'bg-purple-50 text-purple-700 border-purple-200'
    darkStyle = 'bg-purple-400/20 text-purple-300 border-purple-500/30'
  } else if (isWma) {
    label = isCue ? 'WMA · CUE' : 'WMA'
    lightStyle = 'bg-slate-100 text-slate-700 border-slate-200'
    darkStyle = 'bg-slate-700 text-slate-200 border-slate-600'
  } else if (isCue) {
    label = fmt ? `${fmt.toUpperCase()} · CUE` : 'CUE 分轨'
    lightStyle = 'bg-violet-50 text-violet-700 border-violet-200'
    darkStyle = 'bg-violet-400/20 text-violet-300 border-violet-500/30'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border',
        dark ? darkStyle : lightStyle,
        className,
      )}
    >
      {label}
    </span>
  )
}

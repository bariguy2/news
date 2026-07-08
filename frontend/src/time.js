const UNITS = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
]


export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return 'Date unavailable'

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'Date unavailable'

  const differenceInSeconds = (timestamp - now) / 1000
  const absoluteDifference = Math.abs(differenceInSeconds)
  const [unit, secondsPerUnit] = UNITS.find(([, seconds]) => absoluteDifference >= seconds)
    ?? UNITS.at(-1)
  const amount = Math.round(differenceInSeconds / secondsPerUnit)

  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(amount, unit)
}

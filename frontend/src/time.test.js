import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './time.js'


describe('formatRelativeTime', () => {
  const now = Date.parse('2026-07-06T12:00:00Z')

  it('formats past and future timestamps without a date dependency', () => {
    expect(formatRelativeTime('2026-07-06T10:00:00Z', now)).toBe('2 hours ago')
    expect(formatRelativeTime('2026-07-07T12:00:00Z', now)).toBe('tomorrow')
  })

  it('handles missing or malformed timestamps', () => {
    expect(formatRelativeTime(null, now)).toBe('Date unavailable')
    expect(formatRelativeTime('not-a-date', now)).toBe('Date unavailable')
  })
})

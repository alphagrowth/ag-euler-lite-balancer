import { describe, it, expect } from 'vitest'
import { getRelativeTimeBetweenDates } from '~/utils/time-utils'

describe('getRelativeTimeBetweenDates', () => {
  const base = new Date('2024-01-15T12:00:00Z')

  it('returns seconds for recent past', () => {
    const from = base
    const to = new Date(base.getTime() - 30_000) // 30 seconds ago
    const result = getRelativeTimeBetweenDates(from, to)
    expect(result).toContain('second')
  })

  it('returns minutes for minutes ago', () => {
    const from = base
    const to = new Date(base.getTime() - 5 * 60_000)
    const result = getRelativeTimeBetweenDates(from, to)
    expect(result).toContain('minute')
  })

  it('returns hours for hours ago', () => {
    const from = base
    const to = new Date(base.getTime() - 3 * 3600_000)
    const result = getRelativeTimeBetweenDates(from, to)
    expect(result).toContain('hour')
  })

  it('returns days for days ago', () => {
    const from = base
    const to = new Date(base.getTime() - 3 * 86400_000)
    const result = getRelativeTimeBetweenDates(from, to)
    expect(result).toContain('day')
  })
})

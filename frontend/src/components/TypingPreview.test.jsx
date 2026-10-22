import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TypingPreview from './TypingPreview.jsx'

let motion
let motionChanged
beforeEach(() => {
  vi.useFakeTimers()
  motion = { matches: false, addEventListener: vi.fn((_, callback) => { motionChanged = callback }), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', vi.fn(() => motion))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('types Facts before Impact and preserves the complete accessible content', () => {
  const facts = 'These are the facts.'
  const impact = 'This is the impact.'
  const { container } = render(<TypingPreview factsText={facts} impactText={impact} />)
  const visible = container.querySelectorAll('.typing-preview-visible')
  expect(visible[0].textContent).toBe('')
  expect(visible[1].textContent).toBe('')
  expect(container.querySelector('.typing-preview-reserve')).toHaveTextContent(facts)
  expect(visible[0]).toHaveAttribute('aria-hidden', 'true')
  act(() => vi.advanceTimersByTime(120))
  expect(visible[0].textContent.length).toBeGreaterThan(0)
  expect(visible[0].textContent.length).toBeLessThan(facts.length)
  expect(visible[1].textContent).toBe('')
  act(() => vi.advanceTimersByTime(300))
  expect(visible[0]).toHaveTextContent(facts)
  expect(visible[1].textContent.length).toBeGreaterThan(0)
  expect(visible[1].textContent.length).toBeLessThan(impact.length)
  act(() => vi.advanceTimersByTime(300))
  expect(visible[1]).toHaveTextContent(impact)
  expect(visible[0]).toHaveAttribute('data-typing', 'false')
  expect(visible[1]).toHaveAttribute('data-typing', 'false')
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels stale typing when choices change and cleans up on unmount', () => {
  const { container, rerender, unmount } = render(<TypingPreview key="first" factsText="Old facts." impactText="Old impact." />)
  act(() => vi.advanceTimersByTime(240))
  rerender(<TypingPreview key="next" factsText="New facts." impactText="New impact." />)
  const visible = container.querySelectorAll('.typing-preview-visible')
  expect(visible[0].textContent).toBe('')
  act(() => vi.advanceTimersByTime(200))
  expect(visible[0].textContent).not.toContain('Old')
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
  expect(motion.removeEventListener).toHaveBeenCalled()
})

it('shows the full preview immediately with reduced motion and reacts to changes', () => {
  motion.matches = true
  const { container } = render(<TypingPreview factsText="Facts." impactText="Impact." />)
  const visible = container.querySelectorAll('.typing-preview-visible')
  expect(visible[0]).toHaveTextContent('Facts.')
  expect(visible[1]).toHaveTextContent('Impact.')
  expect(vi.getTimerCount()).toBe(0)
  act(() => { motion.matches = false; motionChanged() })
  expect(visible[0].textContent).toBe('')
  expect(vi.getTimerCount()).toBe(1)
  act(() => { motion.matches = true; motionChanged() })
  expect(visible[0]).toHaveTextContent('Facts.')
  expect(visible[1]).toHaveTextContent('Impact.')
  expect(vi.getTimerCount()).toBe(0)
})

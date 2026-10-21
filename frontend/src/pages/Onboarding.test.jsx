import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Onboarding from './Onboarding.jsx'
import { getCategories, updatePreferences } from '../api.js'
import { DEFAULT_SUMMARY_STYLE } from '../components/SummaryStylePicker.jsx'

vi.mock('../api.js', () => ({ getCategories: vi.fn(), updatePreferences: vi.fn() }))

beforeEach(() => {
  getCategories.mockResolvedValue(['Business', 'Science', 'Sports', 'Tech', 'World'])
  updatePreferences.mockResolvedValue({ onboarded: true, selected_categories: ['Sports'], focused_interests: {} })
})
afterEach(() => vi.clearAllMocks())

async function start(categories = ['Business', 'Sports'], onComplete = vi.fn()) {
  render(<MemoryRouter><Onboarding onComplete={onComplete} /></MemoryRouter>)
  for (const category of categories) fireEvent.click(await screen.findByRole('checkbox', { name: category }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  return onComplete
}

it('shows only selected categories in step two and saves nothing before completion', async () => {
  await start()
  expect(screen.getByRole('heading', { name: 'Make it more your own.' })).toHaveFocus()
  expect(screen.getByRole('heading', { name: 'Business' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Sports' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Science' })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Toronto Raptors' })).not.toBeInTheDocument()
  expect(updatePreferences).not.toHaveBeenCalled()
  expect(screen.getByText(/For now, your briefing includes all news/)).toBeVisible()
})

it('preserves selections going back and drops interests when a category is removed', async () => {
  await start()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Finance & banking' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Basketball' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Toronto Raptors' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to categories' }))
  expect(screen.getByRole('checkbox', { name: 'Business' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Sports' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Business' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.queryByRole('heading', { name: 'Business' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Basketball' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Toronto Raptors' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))
  await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(['Sports'], {
    Sports: { topics: ['Basketball'], teams: { Basketball: ['Toronto Raptors'] } },
  }, DEFAULT_SUMMARY_STYLE))
})

it('supports multiple sports and custom teams, and removes teams for deselected sports', async () => {
  await start(['Sports'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Basketball' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Toronto Raptors' }))
  const custom = screen.getByRole('textbox', { name: 'Add another basketball team' })
  fireEvent.change(custom, { target: { value: '  Ottawa BlackJacks  ' } })
  fireEvent.keyDown(custom, { key: 'Enter' })
  expect(screen.getByRole('checkbox', { name: 'Ottawa BlackJacks' })).toBeChecked()
  expect(updatePreferences).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Soccer' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Liverpool' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Basketball' }))
  expect(screen.queryByRole('checkbox', { name: 'Toronto Raptors' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))
  await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(['Sports'], {
    Sports: { topics: ['Soccer'], teams: { Soccer: ['Liverpool'] } },
  }, DEFAULT_SUMMARY_STYLE))
})

it('allows broad interests without choosing subtopics', async () => {
  const onComplete = await start(['Tech'])
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))
  await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(['Tech'], {}, DEFAULT_SUMMARY_STYLE))
  expect(onComplete).toHaveBeenCalledOnce()
})

it('keeps choices on a failed save and prevents duplicate saves until retry', async () => {
  let rejectSave
  updatePreferences.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject }))
  const onComplete = await start(['Business'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Energy' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Analytical' }))
  fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Back to topics' })).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'Analytical' })).toBeDisabled()
  rejectSave(new Error('offline'))
  expect(await screen.findByText('Your preferences could not be saved. Try again.')).toBeVisible()
  expect(screen.getByRole('radio', { name: 'Analytical' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Back to topics' }))
  expect(screen.getByRole('checkbox', { name: 'Energy' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onComplete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(updatePreferences).toHaveBeenCalledTimes(2)
  expect(updatePreferences).toHaveBeenLastCalledWith(['Business'], { Business: { topics: ['Energy'], teams: {} } },
    { tone: 'analytical', length: 'standard', format: 'paragraphs' })
})

it('preserves all three style choices and earlier selections across back navigation', async () => {
  await start(['Sports'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Basketball' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Toronto Raptors' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('heading', { name: 'How do you like your news?' })).toHaveFocus()
  expect(screen.getByRole('radio', { name: 'Neutral' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Paragraphs' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Conversational' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Brief' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Mixed' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to topics' }))
  expect(screen.getByRole('checkbox', { name: 'Toronto Raptors' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByRole('radio', { name: 'Conversational' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Brief' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Mixed' })).toBeChecked()
  expect(updatePreferences).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))
  await waitFor(() => expect(updatePreferences).toHaveBeenCalledWith(['Sports'], {
    Sports: { topics: ['Basketball'], teams: { Basketball: ['Toronto Raptors'] } },
  }, { tone: 'conversational', length: 'brief', format: 'mixed' }))
})

it('limits team choices and accepts an already selected team without duplicating it', async () => {
  await start(['Sports'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Basketball' }))
  const input = screen.getByRole('textbox', { name: 'Add another basketball team' })
  for (let index = 0; index < 20; index++) {
    fireEvent.change(input, { target: { value: `Team ${index}` } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }
  fireEvent.change(input, { target: { value: 'TEAM 0' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getAllByRole('checkbox', { name: 'Team 0', exact: true })).toHaveLength(1)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Toronto Raptors' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choose up to 20 teams per sport.')
  expect(screen.getByRole('checkbox', { name: 'Toronto Raptors' })).not.toBeChecked()
})

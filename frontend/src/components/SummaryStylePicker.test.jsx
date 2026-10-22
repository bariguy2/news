import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'
import SummaryStylePicker, { DEFAULT_SUMMARY_STYLE } from './SummaryStylePicker.jsx'
import SummaryContent from './SummaryContent.jsx'

it('previews tone, length, and each format without requesting an AI summary', () => {
  function Picker() {
    const [value, setValue] = useState(DEFAULT_SUMMARY_STYLE)
    return <SummaryStylePicker value={value} onChange={setValue} />
  }
  render(<Picker />)
  const preview = screen.getByRole('region', { name: 'Your summary, your way.' })
  expect(within(preview).queryByRole('list')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Bullet points' }))
  expect(within(preview).getAllByRole('list')).toHaveLength(2)
  expect(within(preview).getAllByRole('listitem')).toHaveLength(4)
  fireEvent.click(screen.getByRole('radio', { name: 'Brief' }))
  expect(within(preview).getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(screen.getByRole('radio', { name: 'Mixed' }))
  expect(within(preview).getAllByRole('list')).toHaveLength(1)
  fireEvent.click(screen.getByRole('radio', { name: 'Analytical' }))
  expect(preview.querySelector('.typing-preview-reserve')).toHaveTextContent('The proposed bus expansion would increase service coverage.')
  fireEvent.click(screen.getByRole('radio', { name: 'Detailed' }))
  expect(within(preview).getAllByRole('listitem')).toHaveLength(3)
})

it('renders summary lists and paragraphs as safe text, including legacy paragraphs', () => {
  const { container } = render(<SummaryContent text={'A paragraph.\n\n- First fact.\n* Second fact.\n\n<img src=x onerror=alert(1)>'} />)
  expect(screen.getByText('A paragraph.')).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  expect(container.querySelector('img')).toBeNull()
})

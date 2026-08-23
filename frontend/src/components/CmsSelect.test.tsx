import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CmsSelect from './CmsSelect'

const options = [
  { value: 'rg-1', label: 'RG-PROD' },
  { value: 'rg-2', label: 'RG-DEV' },
]

describe('CmsSelect — dropdown via portal (mesmo fix de CmsMultiSelect)', () => {
  it('o dropdown escapa de um ancestral com overflow:hidden', async () => {
    const user = userEvent.setup()
    render(
      <div style={{ overflow: 'hidden', height: 40 }} data-testid="clipped-ancestor">
        <CmsSelect value="" label="" options={options} searchPlaceholder="Buscar..." onChange={vi.fn()} onClear={vi.fn()} />
      </div>,
    )

    await user.click(screen.getByText('— selecione —'))

    const okBtn = await screen.findByRole('button', { name: 'OK ✓' })
    expect(screen.getByTestId('clipped-ancestor').contains(okBtn)).toBe(false)
    expect(document.body.contains(okBtn)).toBe(true)
  });

  it('confirmar a seleção funciona normalmente', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CmsSelect value="" label="" options={options} searchPlaceholder="Buscar..." onChange={onChange} onClear={vi.fn()} />)

    await user.click(screen.getByText('— selecione —'))
    await user.click(screen.getByText('RG-PROD'))
    await user.click(screen.getByRole('button', { name: 'OK ✓' }))

    expect(onChange).toHaveBeenCalledWith('rg-1', 'RG-PROD')
  });
});

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CmsMultiSelect from './CmsMultiSelect'

const options = [
  { value: 'sub-1', label: 'Development' },
  { value: 'sub-2', label: 'Test' },
]

// Bug real: CalculadoraView.tsx tem `overflow:hidden` no container raiz —
// o dropdown (`.cms-dropdown`, position:absolute) ficava recortado nesse
// ancestral, escondendo o rodapé (botão "OK ✓") e impedindo o usuário de
// confirmar a seleção de Assinatura/Resource Group. Simula esse container
// aqui pra provar que o portal escapa do clipping.
function renderInsideClippedContainer(onChange = vi.fn()) {
  return { onChange, ...render(
    <div style={{ overflow: 'hidden', height: 40 }} data-testid="clipped-ancestor">
      <CmsMultiSelect
        values={[]}
        options={options}
        searchPlaceholder="Buscar..."
        triggerLabel="— selecione —"
        onChange={onChange}
      />
    </div>,
  ) }
}

describe('CmsMultiSelect — dropdown via portal (não fica preso em ancestral com overflow:hidden)', () => {
  it('o dropdown (incluindo o rodapé "OK ✓") é renderizado fora do ancestral recortado', async () => {
    const user = userEvent.setup()
    renderInsideClippedContainer()

    await user.click(screen.getByText('— selecione —'))

    const okBtn = await screen.findByRole('button', { name: 'OK ✓' })
    const clippedAncestor = screen.getByTestId('clipped-ancestor')
    expect(clippedAncestor.contains(okBtn)).toBe(false)
    expect(document.body.contains(okBtn)).toBe(true)
  });

  it('confirmar a seleção (mesmo portalado) funciona normalmente', async () => {
    const user = userEvent.setup()
    const { onChange } = renderInsideClippedContainer()

    await user.click(screen.getByText('— selecione —'))
    await user.click(screen.getByText('Development'))
    await user.click(screen.getByRole('button', { name: 'OK ✓' }))

    expect(onChange).toHaveBeenCalledWith(['sub-1'])
    expect(screen.queryByRole('button', { name: 'OK ✓' })).not.toBeInTheDocument()
  });

  it('clicar fora (mesmo com o dropdown portalado) fecha o dropdown', async () => {
    const user = userEvent.setup()
    renderInsideClippedContainer()

    await user.click(screen.getByText('— selecione —'))
    expect(await screen.findByRole('button', { name: 'OK ✓' })).toBeInTheDocument()

    await user.click(document.body)
    expect(screen.queryByRole('button', { name: 'OK ✓' })).not.toBeInTheDocument()
  });
});

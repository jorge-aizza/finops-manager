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

describe('CmsMultiSelect — cascata pai→filho (RG gerenciado)', () => {
  // Bug real: parent_rg resolvido pelo servidor às vezes vem numa grafia
  // diferente da do RG pai real na lista (nomes de RG do Azure são
  // case-insensitive) — a cascata usava `===` estrito e nunca disparava
  // nesses casos, mesmo com pai e filho corretamente agrupados na exibição.
  const rgOptions = [
    { value: 'rg-adbx-vvia-eng-brsouth-001-test', label: 'rg-adbx-vvia-eng-brsouth-001-test' },
    { value: 'managed-rg-adbx-vvia-eng-brsouth-001', label: 'managed-rg-adbx-vvia...', parentValue: 'RG-ADBX-VVIA-ENG-BRSOUTH-001-TEST' },
  ]

  it('marcar o RG pai marca o filho gerenciado mesmo com grafia de caixa diferente', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CmsMultiSelect values={[]} options={rgOptions} searchPlaceholder="Buscar..." triggerLabel="— selecione —" onChange={onChange} />)

    await user.click(screen.getByText('— selecione —'))
    await user.click(screen.getByText('rg-adbx-vvia-eng-brsouth-001-test'))
    await user.click(screen.getByRole('button', { name: 'OK ✓' }))

    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(['rg-adbx-vvia-eng-brsouth-001-test', 'managed-rg-adbx-vvia-eng-brsouth-001']))
  });

  it('desmarcar o RG pai desmarca o filho gerenciado junto', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CmsMultiSelect values={['rg-adbx-vvia-eng-brsouth-001-test', 'managed-rg-adbx-vvia-eng-brsouth-001']} options={rgOptions} searchPlaceholder="Buscar..." triggerLabel="2 selecionados" onChange={onChange} />)

    await user.click(screen.getByText('2 selecionados'))
    await user.click(screen.getByText('rg-adbx-vvia-eng-brsouth-001-test'))
    await user.click(screen.getByRole('button', { name: 'OK ✓' }))

    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('CmsMultiSelect — botão Limpar', () => {
  it('limpa a seleção pendente E o texto da busca', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CmsMultiSelect values={['sub-1']} options={options} searchPlaceholder="Buscar..." triggerLabel="1 selecionado" onChange={onChange} />)

    await user.click(screen.getByText('1 selecionado'))
    await user.type(screen.getByPlaceholderText('Buscar...'), 'Test')
    expect(screen.queryByText('Development')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar' }))

    expect(screen.getByPlaceholderText('Buscar...')).toHaveValue('')
    expect(screen.getByText('Development')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'OK ✓' }))
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

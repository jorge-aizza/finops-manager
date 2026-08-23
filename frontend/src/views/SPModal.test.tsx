import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import SPModal from './SPModal'
import * as coletaApi from '../api/coleta'
import type { ServicePrincipal } from '../types/coleta'

vi.mock('../api/coleta')

const spSubscription: ServicePrincipal = {
  id: 5, nome: 'SP Sub', tenant_id: 'tenant-x', client_id: 'client-x',
  ativo: true, is_padrao: false, expiracao_secret: null, billing_account_id: null,
  billing_profile_id: null, modo_coleta: 'subscription', subscription_ids: 'sub-1',
  granularidade_dias: 7, dia_execucao: 5, hora_execucao: null, dias_semana: null,
  auto_coleta: false, proxima_coleta: null, atualizado_em: '2026-01-01T00:00:00.000Z',
}

function renderWithClient(sp: ServicePrincipal | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SPModal sp={sp} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('SPModal — seletor de subscriptions (modo_coleta=subscription)', () => {
  it('SP existente: busca assinaturas via listarSubsSP e pré-marca as já salvas (subscription_ids)', async () => {
    vi.mocked(coletaApi.listarSubsSP).mockResolvedValue({
      subs: [{ subscriptionId: 'sub-1', nome: 'Assinatura A' }, { subscriptionId: 'sub-2', nome: 'Assinatura B' }],
      fonte: 'tenant',
    })
    renderWithClient(spSubscription)

    await screen.findByText('Assinatura A')
    expect(coletaApi.listarSubsSP).toHaveBeenCalledWith(5)
    // sub-1 já estava em subscription_ids — checkbox vem marcado
    const checkboxA = screen.getByText('Assinatura A').closest('label')!.querySelector('input')!
    expect(checkboxA).toBeChecked()
    const checkboxB = screen.getByText('Assinatura B').closest('label')!.querySelector('input')!
    expect(checkboxB).not.toBeChecked()
  });

  it('SP nova: só busca preview depois que tenant/client/secret estão preenchidos, e salva a seleção como subscription_ids', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.listarSubsPreview).mockResolvedValue({
      subs: [{ subscriptionId: 'sub-9', nome: 'Assinatura Nova' }], fonte: 'tenant',
    })
    vi.mocked(coletaApi.createSP).mockResolvedValue({ ok: true })
    renderWithClient(null)

    await user.selectOptions(screen.getByLabelText('Modo de Coleta *'), 'subscription')
    expect(screen.getByText(/Preencha Tenant ID, Client ID e Client Secret/)).toBeInTheDocument()
    expect(coletaApi.listarSubsPreview).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Nome *'), 'SP Nova')
    await user.type(screen.getByLabelText('Tenant ID *'), 'tenant-novo')
    await user.type(screen.getByLabelText('Client ID *'), 'client-novo')
    await user.type(screen.getByLabelText(/Client Secret/), 'segredo-123')

    await screen.findByText('Assinatura Nova')
    await waitFor(() => expect(coletaApi.listarSubsPreview).toHaveBeenCalledWith({
      tenant_id: 'tenant-novo', client_id: 'client-novo', client_secret: 'segredo-123',
    }))

    await user.click(screen.getByText('Assinatura Nova').closest('label')!.querySelector('input')!)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(coletaApi.createSP).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_ids: 'sub-9' }),
    ))
  });
});

describe('SPModal — granularidade de coleta (7/15/30/Livre)', () => {
  it('default de uma SP nova é 7 dias (preset fixo, sem picker de datas)', async () => {
    renderWithClient(null)
    expect(screen.getByLabelText('Granularidade de coleta')).toHaveValue('7')
    expect(screen.queryByText(/dia.*selecionado/)).not.toBeInTheDocument()
  });

  it('SP existente com granularidade fora dos presets (ex: 4) abre no modo Livre', () => {
    renderWithClient({ ...spSubscription, granularidade_dias: 4 })
    expect(screen.getByLabelText('Granularidade de coleta')).toHaveValue('0')
    expect(screen.getByText('4 dias selecionados')).toBeInTheDocument()
  });

  it('escolher "Livre" mostra o picker de datas e calcula os dias salvos ao submeter', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.listarSubsSP).mockResolvedValue({ subs: [], fonte: 'tenant' })
    vi.mocked(coletaApi.updateSP).mockResolvedValue({ ok: true })
    renderWithClient(spSubscription)

    await user.selectOptions(screen.getByLabelText('Granularidade de coleta'), '0')
    const [deInput, ateInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/)
    await user.clear(deInput); await user.type(deInput, '2026-08-01')
    await user.clear(ateInput); await user.type(ateInput, '2026-08-10')

    expect(screen.getByText('10 dias selecionados')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(coletaApi.updateSP).toHaveBeenCalledWith(5, expect.objectContaining({ granularidade_dias: 10 })))
  });
});

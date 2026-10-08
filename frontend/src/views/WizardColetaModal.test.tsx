import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import WizardColetaModal from './WizardColetaModal'
import * as coletaApi from '../api/coleta'
import type { ServicePrincipal } from '../types/coleta'

vi.mock('../api/coleta')

const spSubscription: ServicePrincipal = {
  id: 1, nome: 'SP Subscription', tenant_id: 't', client_id: 'c',
  ativo: true, is_padrao: false, expiracao_secret: null, billing_account_id: null,
  billing_profile_id: null, modo_coleta: 'subscription', subscription_ids: null,
  granularidade_dias: 7, dia_execucao: 5, hora_execucao: null, dias_semana: null,
  auto_coleta: false, proxima_coleta: null, atualizado_em: '2026-01-01T00:00:00.000Z',
}

const spBillingProfile: ServicePrincipal = {
  ...spSubscription, id: 2, nome: 'SP Billing', modo_coleta: 'billing_profile',
  billing_account_id: 'BA-1', billing_profile_id: 'BP-1',
}

function renderWithClient(sp: ServicePrincipal, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <WizardColetaModal sp={sp} onClose={onClose} />
    </QueryClientProvider>,
  ) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(coletaApi.getColetaStatus).mockResolvedValue({
    em_execucao: false, cancelando: false, progresso: null, execucoes: [],
    ultimo: null, ultimo_api: null, ultimo_storage: null,
    agendador_ativo: true, circuit_breaker: { state: 'closed', failures: 0, open_until: null },
  })
  vi.mocked(coletaApi.coletarAPI).mockResolvedValue({ ok: true, message: 'Coleta iniciada' })
  vi.mocked(coletaApi.salvarAgendamentoSP).mockResolvedValue({ ok: true, sp: {} })
  window.showToast = vi.fn()
})

describe('WizardColetaModal', () => {
  it('modo subscription: percorre os 4 passos e envia subscription_ids selecionados', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.listarSubsSP).mockResolvedValue({
      subs: [{ subscriptionId: 'sub-1', nome: 'Assinatura A' }, { subscriptionId: 'sub-2', nome: 'Assinatura B' }],
      fonte: 'tenant',
    })
    vi.mocked(coletaApi.listarRGsSP).mockResolvedValue({ rgs: [{ subscriptionId: 'sub-1', name: 'RG-1' }], fonte: 'arm' })

    const { onClose } = renderWithClient(spSubscription)

    await screen.findByText('Assinatura A')
    await user.click(screen.getByText('Assinatura A').closest('label')!.querySelector('input')!)
    await user.click(screen.getByRole('button', { name: 'Avançar' }))

    await screen.findByText('RG-1')
    await user.click(screen.getByRole('button', { name: 'Avançar' })) // sem selecionar RG — "todos"

    await screen.findByText('3. Período')
    await user.click(screen.getByRole('button', { name: 'Mês atual' }))
    await user.click(screen.getByRole('button', { name: 'Avançar' }))

    await screen.findByText('4. Confirmar')
    await user.click(screen.getByRole('button', { name: '▶ Iniciar Coleta' }))

    await waitFor(() => expect(coletaApi.coletarAPI).toHaveBeenCalledWith(1, expect.objectContaining({
      modo: 'subscription', subscription_ids: ['sub-1'], resource_groups: [], metric: 'ActualCost',
    })))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  });

  it('modo billing_profile (escopo padrão): pula os passos de assinatura/RG', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWithClient(spBillingProfile)

    expect(screen.getByText(/Escopo "Billing Profile" selecionado/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Avançar' })) // step 1 -> pula pro 3

    await screen.findByText('3. Período')
    await user.click(screen.getByRole('button', { name: 'Mês atual' }))
    await user.click(screen.getByRole('button', { name: 'Avançar' }))

    await screen.findByText('4. Confirmar')
    await user.click(screen.getByRole('button', { name: '▶ Iniciar Coleta' }))

    await waitFor(() => expect(coletaApi.coletarAPI).toHaveBeenCalledWith(2, expect.objectContaining({
      modo: 'billing_profile', billing_account_id: 'BA-1', billing_profile_id: 'BP-1',
    })))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  });

  it('bloqueia o início se a SP específica já está coletando', async () => {
    const user = userEvent.setup()
    const progresso = { tipo: 'api' as const, fase: 'Buscando', ins: 0, upd: 0, err: 0, log: [] }
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue({
      em_execucao: true, cancelando: false, progresso, execucoes: [{
        tipo: 'api', id: 2, iniciado_em: '2026-01-01T00:00:00.000Z', cancelando: false,
        progresso, status: null,
      }],
      ultimo: null, ultimo_api: null, ultimo_storage: null,
      agendador_ativo: true, circuit_breaker: { state: 'closed', failures: 0, open_until: null },
    })
    renderWithClient(spBillingProfile)

    await user.click(screen.getByRole('button', { name: 'Avançar' }))
    await screen.findByText('3. Período')
    await user.click(screen.getByRole('button', { name: 'Mês atual' }))
    await user.click(screen.getByRole('button', { name: 'Avançar' }))
    await screen.findByText('4. Confirmar')
    await user.click(screen.getByRole('button', { name: '▶ Iniciar Coleta' }))

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('coletando'), 'error'))
    expect(coletaApi.coletarAPI).not.toHaveBeenCalled()
  });

  it('agendar recorrência na etapa 4 salva o agendamento antes de iniciar a coleta', async () => {
    const user = userEvent.setup()
    renderWithClient(spBillingProfile)

    await user.click(screen.getByRole('button', { name: 'Avançar' }))
    await screen.findByText('3. Período')
    await user.click(screen.getByRole('button', { name: 'Mês atual' }))
    await user.click(screen.getByRole('button', { name: 'Avançar' }))
    await screen.findByText('4. Confirmar')

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '▶ Iniciar Coleta' }))

    await waitFor(() => expect(coletaApi.salvarAgendamentoSP).toHaveBeenCalledWith(2, expect.objectContaining({ auto_coleta: true })))
    await waitFor(() => expect(coletaApi.coletarAPI).toHaveBeenCalled())
  });
});

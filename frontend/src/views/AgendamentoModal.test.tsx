import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AgendamentoModal from './AgendamentoModal'
import * as coletaApi from '../api/coleta'
import type { ServicePrincipal } from '../types/coleta'

vi.mock('../api/coleta')

const spComAgendamento: ServicePrincipal = {
  id: 3, nome: 'SP Agendada', tenant_id: 't', client_id: 'c',
  ativo: true, is_padrao: false, expiracao_secret: null,
  billing_account_id: null, billing_profile_id: null,
  modo_coleta: 'subscription', subscription_ids: 'sub-1,sub-2',
  granularidade_dias: 7, dia_execucao: 5, hora_execucao: 6, dias_semana: '1,2,3,4,5',
  auto_coleta: true, proxima_coleta: null, atualizado_em: '2026-01-01T00:00:00.000Z',
}

function renderWithClient(sp: ServicePrincipal, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <AgendamentoModal sp={sp} onClose={onClose} />
    </QueryClientProvider>,
  ) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(coletaApi.getColetaStatus).mockResolvedValue({
    em_execucao: false, cancelando: false, progresso: null, ultimo: null, ultimo_api: null, ultimo_storage: null,
    agendador_ativo: true, circuit_breaker: { state: 'closed', failures: 0, open_until: null },
  })
  vi.mocked(coletaApi.salvarAgendamentoSP).mockResolvedValue({ ok: true, sp: {} })
  vi.mocked(coletaApi.excluirAgendamentoSP).mockResolvedValue({ ok: true })
  vi.mocked(coletaApi.coletarAPI).mockResolvedValue({ ok: true, message: 'Coleta iniciada' })
  window.showToast = vi.fn()
})

describe('AgendamentoModal', () => {
  it('salva o agendamento com os dias/hora configurados', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWithClient(spComAgendamento)

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(coletaApi.salvarAgendamentoSP).toHaveBeenCalledWith(3, {
      hora_execucao: 6, dias_semana: '1,2,3,4,5', auto_coleta: true,
    }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  });

  it('"Coletar agora" usa o escopo salvo da SP e uma janela rolante de granularidade_dias', async () => {
    const user = userEvent.setup()
    renderWithClient(spComAgendamento)

    await user.click(screen.getByRole('button', { name: /Coletar agora/ }))

    await waitFor(() => expect(coletaApi.coletarAPI).toHaveBeenCalledWith(3, expect.objectContaining({
      modo: 'subscription', subscription_ids: ['sub-1', 'sub-2'], metric: 'ActualCost',
    })))
    const call = vi.mocked(coletaApi.coletarAPI).mock.calls[0][1]
    const dias = (new Date(call.data_fim).getTime() - new Date(call.data_inicio).getTime()) / 86400000
    expect(Math.round(dias)).toBe(7)
  });

  it('remove o agendamento existente', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWithClient(spComAgendamento)

    await user.click(screen.getByRole('button', { name: 'Remover agendamento' }))

    await waitFor(() => expect(coletaApi.excluirAgendamentoSP).toHaveBeenCalledWith(3))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  });

  it('sem agendamento ativo: botão "Remover agendamento" não aparece', async () => {
    renderWithClient({ ...spComAgendamento, auto_coleta: false })
    expect(screen.queryByRole('button', { name: 'Remover agendamento' })).not.toBeInTheDocument()
  });

  it('bloqueia "Coletar agora" se já existe uma coleta em execução', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue({
      em_execucao: true, cancelando: false, progresso: null, ultimo: null, ultimo_api: null, ultimo_storage: null,
      agendador_ativo: true, circuit_breaker: { state: 'closed', failures: 0, open_until: null },
    })
    renderWithClient(spComAgendamento)

    await user.click(screen.getByRole('button', { name: /Coletar agora/ }))

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('em execução'), 'error'))
    expect(coletaApi.coletarAPI).not.toHaveBeenCalled()
  });
});

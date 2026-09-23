import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ReservasView from './ReservasView'
import * as reservasApi from '../api/reservas'
import * as azureApi from '../api/azure'
import * as coletaApi from '../api/coleta'
import type { Reserva } from '../types/reserva'

vi.mock('../api/reservas')
vi.mock('../api/azure')
vi.mock('../api/coleta')

const mockReservas: Reserva[] = [
  {
    id: 1,
    cloud: 'AWS',
    nome_reserva: 'EC2-Prod-Reserva',
    tipo_escopo: 'Account',
    subscription_id: '123456789012',
    resource_group_name: null,
    tipo_recurso: 'EC2 Reserved Instances',
    instancia: 'm5.xlarge',
    quantidade: 2,
    prazo: '1 ano',
    opcao_pagamento: 'All Upfront',
    custo_total: 5000,
    custo_mensal: 416.67,
    data_inicio: '2026-01-01',
    data_vencimento: '2026-06-01',
    status: 'Ativa',
    observacoes: null,
    criado_por: 1,
    criado_em: '2026-01-01T12:00:00.000Z',
    atualizado_em: '2026-01-01T12:00:00.000Z',
  },
]

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReservasView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(reservasApi.listReservas).mockResolvedValue(mockReservas)
  vi.mocked(azureApi.listSubscriptions).mockResolvedValue([])
  vi.mocked(coletaApi.listSPs).mockResolvedValue([{ id: 7, nome: 'SP Principal', ativo: true, is_padrao: true } as never])
})

describe('ReservasView', () => {
  it('lista as reservas vindas da API', async () => {
    renderWithClient()

    const row = (await screen.findByText('EC2-Prod-Reserva')).closest('tr')!
    expect(row).toHaveTextContent('AWS')
    expect(row).toHaveTextContent('Ativa');
  });

  it('mostra estado vazio quando não há reservas', async () => {
    vi.mocked(reservasApi.listReservas).mockResolvedValue([])
    renderWithClient()

    expect(await screen.findByText('Nenhuma reserva encontrada')).toBeInTheDocument()
  });

  it('cria uma reserva Multicloud/Shared (sem dropdown de busca)', async () => {
    const user = userEvent.setup()
    vi.mocked(reservasApi.createReserva).mockResolvedValue({ ...mockReservas[0], id: 2 })

    renderWithClient()
    await screen.findByText('EC2-Prod-Reserva')

    await user.click(screen.getByRole('button', { name: 'Nova Reserva' }))
    await user.selectOptions(screen.getByLabelText('Cloud *'), 'Multicloud')
    await user.type(screen.getByLabelText('Nome da Reserva *'), 'Reserva Teste')
    await user.selectOptions(screen.getByLabelText('Tipo de Recurso *'), 'Capacidade Reservada Geral')
    await user.type(screen.getByLabelText('Data de Vencimento *'), '2027-01-01')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(reservasApi.createReserva).toHaveBeenCalledWith(
        expect.objectContaining({
          cloud: 'Multicloud',
          nome_reserva: 'Reserva Teste',
          tipo_escopo: 'Shared',
          tipo_recurso: 'Capacidade Reservada Geral',
          data_vencimento: '2027-01-01',
          subscription_id: null,
          resource_group_name: null,
        }),
      )
    });
  });

  it('sincroniza com a Azure usando a SP configurada e recarrega a lista', async () => {
    const user = userEvent.setup()
    vi.mocked(reservasApi.sincronizarReservasAzure).mockResolvedValue({
      ok: true, sp: 'SP Principal', total: 3, inseridas: 2, atualizadas: 1, avisos: ['Savings Plans não lidos: sem permissão.'],
    })
    renderWithClient()
    await screen.findByText('EC2-Prod-Reserva')

    const botao = await screen.findByRole('button', { name: 'Sincronizar com Azure' })
    await waitFor(() => expect(botao).toBeEnabled())
    const chamadasAntes = vi.mocked(reservasApi.listReservas).mock.calls.length
    await user.click(botao)

    await waitFor(() => expect(reservasApi.sincronizarReservasAzure).toHaveBeenCalledWith(undefined))
    expect(await screen.findByText(/3 encontrada\(s\) — 2 nova\(s\), 1 atualizada\(s\)/)).toBeInTheDocument()
    expect(screen.getByText(/Savings Plans não lidos/)).toBeInTheDocument()
    await waitFor(() => expect(reservasApi.listReservas).toHaveBeenCalledTimes(chamadasAntes + 1))
  });

  it('desabilita a sincronização quando não há SP ativa', async () => {
    vi.mocked(coletaApi.listSPs).mockResolvedValue([])
    renderWithClient()
    await screen.findByText('EC2-Prod-Reserva')
    expect(screen.getByRole('button', { name: 'Sincronizar com Azure' })).toBeDisabled()
  });

  it('filtra por texto de busca', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('EC2-Prod-Reserva')

    await user.type(screen.getByPlaceholderText('Buscar reserva...'), 'inexistente')
    expect(await screen.findByText('Nenhuma reserva encontrada')).toBeInTheDocument()
  });
});

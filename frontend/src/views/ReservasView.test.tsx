import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ReservasView from './ReservasView'
import * as reservasApi from '../api/reservas'
import * as azureApi from '../api/azure'
import type { Reserva } from '../types/reserva'

vi.mock('../api/reservas')
vi.mock('../api/azure')

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

  it('filtra por texto de busca', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('EC2-Prod-Reserva')

    await user.type(screen.getByPlaceholderText('Buscar reserva...'), 'inexistente')
    expect(await screen.findByText('Nenhuma reserva encontrada')).toBeInTheDocument()
  });
});

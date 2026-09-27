import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PublicOrfaosView from './PublicOrfaosView'
import * as orfaosApi from '../api/orfaosPublica'
import type { OrfaosPublicaResposta } from '../types/orfaosPublica'

vi.mock('../api/orfaosPublica')

const resposta: OrfaosPublicaResposta = {
  gerado_em: '2026-09-26T12:00:00Z',
  total_itens: 3,
  custo_mensal_estimado_total: 150,
  por_categoria: [
    { categoria: 'disco_orfao', itens: 2, custo_mensal_estimado: 150 },
    { categoria: 'ip_solto', itens: 1, custo_mensal_estimado: 0 },
  ],
  itens: [
    { nome: 'disco-a', categoria: 'disco_orfao', resource_group: 'RG-A', sku: 'Premium_LRS', tamanho_gb: 128, custo_mensal_estimado: 100, dias_orfao: 40 },
    { nome: 'disco-b', categoria: 'disco_orfao', resource_group: 'RG-B', sku: 'Standard_LRS', tamanho_gb: 64, custo_mensal_estimado: 50, dias_orfao: 5 },
    { nome: 'ip-x', categoria: 'ip_solto', resource_group: 'RG-A', sku: 'Standard', tamanho_gb: null, custo_mensal_estimado: null, dias_orfao: null },
  ],
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicOrfaosView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(orfaosApi.getOrfaosPublica).mockResolvedValue(resposta)
})

describe('PublicOrfaosView', () => {
  it('lista os recursos, o custo total e mostra "—" (nunca R$ 0,00) sem billing', async () => {
    renderView()
    expect(await screen.findByText('disco-a')).toBeInTheDocument()
    expect(screen.getByText('ip-x')).toBeInTheDocument()
    expect(screen.getAllByText(/R\$\s150,00/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 recurso\(s\) sem billing conhecido/)).toBeInTheDocument()
  })

  it('filtra por Resource Group e por busca', async () => {
    const user = userEvent.setup()
    renderView()
    await screen.findByText('disco-a')

    await user.selectOptions(screen.getByLabelText('Resource Group'), 'RG-B')
    expect(screen.queryByText('disco-a')).not.toBeInTheDocument()
    expect(screen.getByText('disco-b')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await user.type(screen.getByPlaceholderText('Buscar por nome do recurso...'), 'ip-')
    expect(screen.getByText('ip-x')).toBeInTheDocument()
    expect(screen.queryByText('disco-a')).not.toBeInTheDocument()
  })

  it('mostra a mensagem do servidor quando a consulta falha', async () => {
    vi.mocked(orfaosApi.getOrfaosPublica).mockRejectedValue(new Error('Visão de recursos órfãos desativada'))
    renderView()
    expect(await screen.findByText('Visão de recursos órfãos desativada')).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há recursos', async () => {
    vi.mocked(orfaosApi.getOrfaosPublica).mockResolvedValue({ ...resposta, total_itens: 0, itens: [], por_categoria: [], custo_mensal_estimado_total: 0 })
    renderView()
    expect(await screen.findByText('Nenhum recurso órfão para exibir.')).toBeInTheDocument()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import RecursoDetalheModal from './RecursoDetalheModal'
import * as azureApi from '../api/azureInventario'
import * as calcApi from '../api/calculadora'
import type { AzureRecursoDetalheResposta } from '../types/azureInventario'

type PropriedadeHistoricoResposta = Awaited<ReturnType<typeof azureApi.getAzurePropriedadeHistorico>>

vi.mock('../api/azureInventario')
vi.mock('../api/calculadora')

// Reproduz o cenário exato do print do usuário: a tabela "Alterações de Propriedade" (filtrada
// por período) mostrava só a mudança D2as_v5→E2as_v5, mas o modal do mesmo recurso mostrava 2
// alterações, porque busca a vida inteira do recurso — não o período da tela. Opção D (2026-09-27):
// marcar visualmente qual alteração ficou fora do período, em vez de deixar os números
// divergirem sem explicação.

const RESOURCE_ID = '/subscriptions/sub-1/resourceGroups/rg-ceng-brsouth-dev/providers/Microsoft.Compute/virtualMachines/vm-x'
const SUB_ID = 'sub-1'

const detalhe: AzureRecursoDetalheResposta = {
  recurso: {
    id: 10, subscription_id: SUB_ID, resource_id: RESOURCE_ID, resource_type: 'microsoft.compute/virtualmachines',
    resource_group: 'rg-ceng-brsouth-dev', nome: 'vm-x', criado_por: 'System', criado_em: '2026-09-02T06:09:00Z',
    atualizado_por: 'System', atualizado_em: '2026-09-27T09:10:00Z', excluido_por: null, excluido_em: null,
    ativo: true, detectado_em: '2026-09-02T06:09:00Z', custo_acumulado: 2170.95, custo_resource_group: 2170.95,
  } as AzureRecursoDetalheResposta['recurso'],
  eventos: [],
  custo_diario: [],
  custo_resource_group: 2170.95,
  resource_group_recursos: 4,
  billing_detalhe: null,
}

// A mesma rota devolve a "vida inteira" do recurso (2 mudanças) quando chamada com resource_id —
// só o período da linha (13/09) está dentro da janela De/Até que a tela estava filtrando (10 a 13/09).
const historicoCompleto: PropriedadeHistoricoResposta = {
  periodo: { inicio: '2015-01-01', fim: '2026-09-27' },
  total: 2,
  mudancas: [
    { id: 2, subscription_id: SUB_ID, resource_id: RESOURCE_ID, resource_type: 'microsoft.compute/virtualmachines', resource_group: 'rg-ceng-brsouth-dev', propriedade: 'sku_vm', propriedade_label: 'SKU da VM', valor_anterior: 'Standard_E2as_v5', valor_novo: 'Standard_B4as_v2', detectado_em: '2026-09-14T09:49:00Z', evento_autor: 'anna.hamann@telefonicati.onmicrosoft.com', evento_quando: '2026-09-14T09:49:00Z', nome: 'vm-x', evento_autor_nome: null },
    { id: 1, subscription_id: SUB_ID, resource_id: RESOURCE_ID, resource_type: 'microsoft.compute/virtualmachines', resource_group: 'rg-ceng-brsouth-dev', propriedade: 'sku_vm', propriedade_label: 'SKU da VM', valor_anterior: 'Standard_D2as_v5', valor_novo: 'Standard_E2as_v5', detectado_em: '2026-09-13T17:23:00Z', evento_autor: 'anna.hamann@telefonicati.onmicrosoft.com', evento_quando: '2026-09-13T17:23:00Z', nome: 'vm-x', evento_autor_nome: null },
  ],
}

function renderModal(periodoFiltro?: { inicio: string; fim: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RecursoDetalheModal resourceId={RESOURCE_ID} subscriptionId={SUB_ID} periodoFiltro={periodoFiltro} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(azureApi.getAzureRecursoDetalhe).mockResolvedValue(detalhe)
  vi.mocked(azureApi.getAzurePropriedadeHistorico).mockResolvedValue(historicoCompleto)
  vi.mocked(calcApi.listSubscriptions).mockResolvedValue([{ subscription_id: SUB_ID, subscription_name: 'Assinatura Teste', periodo_inicio: null, periodo_fim: null, moeda: null }])
})

describe('RecursoDetalheModal — opção D (marcar alterações fora do período da tela)', () => {
  it('sem periodoFiltro (aberto pela aba Recursos, sem período de tela): mostra as 2 alterações sem nenhum badge', async () => {
    renderModal(undefined)
    await waitFor(() => expect(screen.getByText(/Histórico de Alterações \(2 alterações\)/)).toBeInTheDocument())
    expect(screen.getByText(/vida inteira do recurso, não limitado a nenhum período/)).toBeInTheDocument()
    expect(screen.queryByText('fora do período')).not.toBeInTheDocument()
  })

  it('com periodoFiltro (aberto pela tabela de Alterações de Propriedade, 10 a 13/09): marca só a mudança de 14/09 como fora do período', async () => {
    renderModal({ inicio: '2026-09-10', fim: '2026-09-13' })
    await waitFor(() => expect(screen.getByText(/Histórico de Alterações \(2 alterações\)/)).toBeInTheDocument())

    // O aviso explica por que o total aqui (2) é maior que o da tabela de origem (1).
    expect(screen.getByText(/não só o período selecionado na tela \(10\/09\/26 a 13\/09\/26\)/)).toBeInTheDocument()
    expect(screen.getByText(/por isso o total aqui pode ser maior que o da tabela/)).toBeInTheDocument()

    // Só 1 badge — a mudança de 14/09 está fora da janela 10–13/09.
    expect(screen.getAllByText('fora do período')).toHaveLength(1)

    // A linha de 13/09 (dentro do período) não tem o badge; a de 14/09 (fora, único valor
    // "Standard_B4as_v2" na tela) tem. `Standard_E2as_v5` não serve de âncora aqui — é o
    // valor_novo de uma linha e o valor_anterior da outra ao mesmo tempo.
    const linhaDentro = screen.getByText('Standard_D2as_v5').closest('div')!.parentElement!
    const linhaFora = screen.getByText('Standard_B4as_v2').closest('div')!.parentElement!
    expect(linhaDentro.textContent).not.toContain('fora do período')
    expect(linhaFora.textContent).toContain('fora do período')
  })

  it('quando todas as alterações caem dentro do período: não mostra nenhum badge, só confirma que bate com a tabela', async () => {
    renderModal({ inicio: '2026-09-01', fim: '2026-09-30' })
    await waitFor(() => expect(screen.getByText(/Histórico de Alterações \(2 alterações\)/)).toBeInTheDocument())
    expect(screen.getByText(/Todas as alterações abaixo caem dentro do período selecionado na tela/)).toBeInTheDocument()
    expect(screen.queryByText('fora do período')).not.toBeInTheDocument()
  })
})

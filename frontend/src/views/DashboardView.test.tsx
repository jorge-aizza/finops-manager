import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DashboardView from './DashboardView'
import * as acoesApi from '../api/acoes'
import * as estimativasApi from '../api/estimativas'
import * as projetosApi from '../api/projetos'
import * as usuariosApi from '../api/usuarios'
import type { Acao } from '../types/acao'
import type { EstimativaResumo } from '../types/estimativa'

vi.mock('../api/acoes')
vi.mock('../api/estimativas')
vi.mock('../api/projetos')
vi.mock('../api/usuarios')

function makeAcao(overrides: Partial<Acao>): Acao {
  return {
    id: 1, id_finops: 'FINOPS-001', projeto_id: null, projeto_nome: 'Projeto Alpha',
    acao: 'Rightsizing VMs', cloud: 'Azure', responsavel: 'Ana Souza', tipo_acao: 'Rightsizing',
    impacto_atual_mes: 100, status: 'Em Andamento', data_inicio: '2026-01-01', data_conclusao: '2026-12-31',
    retorno_ano_atual: 1000, retorno_proximo_ano: 2000,
    atual_janeiro: 0, atual_fevereiro: 0, atual_marco: 0, atual_abril: 0, atual_maio: 0, atual_junho: 0,
    atual_julho: 0, atual_agosto: 0, atual_setembro: 0, atual_outubro: 0, atual_novembro: 0, atual_dezembro: 0,
    proximo_janeiro: 0, proximo_fevereiro: 0, proximo_marco: 0, proximo_abril: 0, proximo_maio: 0, proximo_junho: 0,
    proximo_julho: 0, proximo_agosto: 0, proximo_setembro: 0, proximo_outubro: 0, proximo_novembro: 0, proximo_dezembro: 0,
    criado_em: '2026-01-01T00:00:00.000Z', atualizado_em: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeEstimativa(overrides: Partial<EstimativaResumo>): EstimativaResumo {
  return {
    id: 1, projeto_id: 1, projeto_nome: 'Projeto Alpha', numero: 'EST-1', titulo: 'Estimativa',
    responsavel: 'Ana', validade_dias: 5, data_estimativa: '2026-08-01', horas: 720,
    pct_imposto: 0, pct_cond: 0, vl_imposto: 0, vl_cond: 0, total_brl: 1000, total_final: 1000,
    observacoes: null, status: 'Pendente', criado_em: '2026-08-01T00:00:00.000Z', atualizado_em: '2026-08-01T00:00:00.000Z',
    projeto_nome_atual: 'Projeto Alpha',
    ...overrides,
  }
}

const mockAcoes: Acao[] = [
  makeAcao({ id: 1, cloud: 'Azure', status: 'Em Andamento', data_conclusao: '2099-12-31', acao: 'Rightsizing VMs' }),
  makeAcao({ id: 2, cloud: 'AWS', status: 'Concluído', data_conclusao: '2026-01-01', acao: 'Migração de Storage' }),
  makeAcao({ id: 3, cloud: 'Azure', status: 'Planejado', data_conclusao: '2020-01-01', acao: 'Ação Atrasada' }),
]

const mockEstimativas: EstimativaResumo[] = [
  makeEstimativa({ id: 1, status: 'Aprovado', total_final: 5000 }),
  makeEstimativa({ id: 2, status: 'Nao Aprovado', total_final: 2000 }),
  makeEstimativa({ id: 3, status: 'Pendente', total_final: 800 }),
]

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(acoesApi.listAcoes).mockResolvedValue(mockAcoes)
  vi.mocked(estimativasApi.listEstimativas).mockResolvedValue(mockEstimativas)
  vi.mocked(projetosApi.listProjetos).mockResolvedValue([])
  vi.mocked(usuariosApi.listUsuarios).mockResolvedValue([])
  window.exportarExcel = vi.fn()
  window.showView = vi.fn()
  // `bridge.ts` mantém `currentDashboardTab`/listener como estado de módulo
  // (singleton) — sem resetar aqui, um teste que troca de aba vaza pro
  // próximo (o `useEffect` de montagem chama o listener de novo com o
  // valor persistido, não o default 'acoes').
  window.__reactBridge?.setDashboardTab('acoes')
})

describe('DashboardView', () => {
  it('mostra os stat cards de ações vindos da API', async () => {
    renderWithClient()
    await screen.findByText('Rightsizing VMs')
    // stat-total = 3
    const totalCard = screen.getByText('Total de Ações').closest('.stat-card')!
    expect(totalCard).toHaveTextContent('3')
  });

  it('separa ações atrasadas da lista de ações recentes', async () => {
    renderWithClient()
    await screen.findByText('Rightsizing VMs')
    expect(screen.getByText('Ação Atrasada')).toBeInTheDocument()
    // Não aparece duplicada na tabela de recentes
    const atrasadaCard = screen.getByText('Ações com Prazo Vencido').closest('.card')!
    expect(atrasadaCard).toHaveTextContent('Ação Atrasada')
  });

  it('filtra ações por cloud ao clicar no card e limpa no segundo clique', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('Rightsizing VMs')

    const awsCard = screen.getByText('AWS', { selector: '.cloud-stat-name' }).closest('.cloud-stat-card')!
    await user.click(awsCard)
    expect(screen.queryByText('Rightsizing VMs')).not.toBeInTheDocument()

    await user.click(awsCard)
    await waitFor(() => expect(screen.getByText('Rightsizing VMs')).toBeInTheDocument())
  });

  it('troca de aba via setDashboardTabListener (ponte com o sidebar legado)', async () => {
    renderWithClient()
    await screen.findByText('Rightsizing VMs')
    expect(screen.queryByText('Detalhamento por Projeto')).not.toBeInTheDocument()

    window.__reactBridge.setDashboardTab('estimativas')

    expect(await screen.findByText('Detalhamento por Projeto')).toBeInTheDocument()
    expect(screen.getAllByText('R$ 5.000').length).toBeGreaterThan(0)
  });

  it('abre o modal de edição ao clicar em "Ver detalhes"', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('Rightsizing VMs')

    await user.click(screen.getAllByTitle('Ver detalhes')[0])
    expect(await screen.findByDisplayValue('Rightsizing VMs')).toBeInTheDocument()
  });
});

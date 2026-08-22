import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AcoesView from './AcoesView'
import * as acoesApi from '../api/acoes'
import * as projetosApi from '../api/projetos'
import * as usuariosApi from '../api/usuarios'
import type { Acao } from '../types/acao'

vi.mock('../api/acoes')
vi.mock('../api/projetos')
vi.mock('../api/usuarios')

const mockAcoes: Acao[] = [
  {
    id: 1, id_finops: 'FINOPS-001', projeto_id: null, projeto_nome: null,
    acao: 'Rightsizing VMs produção', cloud: 'Azure', responsavel: 'Ana Souza',
    tipo_acao: 'Rightsizing', impacto_atual_mes: 1200, status: 'Em Andamento',
    data_inicio: '2026-01-01', data_conclusao: '2026-12-31',
    retorno_ano_atual: 5000, retorno_proximo_ano: 8000,
    atual_janeiro: 500, atual_fevereiro: 500, atual_marco: 0, atual_abril: 0, atual_maio: 0, atual_junho: 0,
    atual_julho: 0, atual_agosto: 0, atual_setembro: 0, atual_outubro: 0, atual_novembro: 0, atual_dezembro: 0,
    proximo_janeiro: 0, proximo_fevereiro: 0, proximo_marco: 0, proximo_abril: 0, proximo_maio: 0, proximo_junho: 0,
    proximo_julho: 0, proximo_agosto: 0, proximo_setembro: 0, proximo_outubro: 0, proximo_novembro: 0, proximo_dezembro: 0,
    criado_em: '2026-01-01T12:00:00.000Z', atualizado_em: '2026-01-01T12:00:00.000Z',
  },
]

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AcoesView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(acoesApi.listAcoes).mockResolvedValue(mockAcoes)
  vi.mocked(projetosApi.listProjetos).mockResolvedValue([])
  vi.mocked(usuariosApi.listUsuarios).mockResolvedValue([
    { id: 1, nome: 'Ana Souza', email: 'ana@vivo.com', ativo: true },
    { id: 2, nome: 'Inativo Silva', email: 'inativo@vivo.com', ativo: false },
  ])
})

describe('AcoesView', () => {
  it('lista as ações vindas da API', async () => {
    renderWithClient()
    const row = (await screen.findByText('Rightsizing VMs produção')).closest('tr')!
    expect(row).toHaveTextContent('FINOPS-001')
    expect(row).toHaveTextContent('Em Andamento')
    expect(row).toHaveTextContent('R$ 5.000,00')
  });

  it('mostra estado vazio quando não há ações', async () => {
    vi.mocked(acoesApi.listAcoes).mockResolvedValue([])
    renderWithClient()
    expect(await screen.findByText('Nenhuma ação encontrada')).toBeInTheDocument()
  });

  it('cria uma ação e soma os 12 meses em retorno_ano_atual', async () => {
    const user = userEvent.setup()
    vi.mocked(acoesApi.createAcao).mockResolvedValue({ ...mockAcoes[0], id: 2 })

    renderWithClient()
    await screen.findByText('Rightsizing VMs produção')

    await user.click(screen.getByRole('button', { name: 'Nova Ação' }))
    await user.type(screen.getByLabelText('Ação *'), 'Ação de Teste')
    await user.selectOptions(screen.getByLabelText('Status *'), 'Planejado')

    // Preenche só 2 dos 12 meses do bloco "Ano Atual" — o resto fica vazio/0
    // (aria-label inclui o título da seção pra desambiguar de "Retorno Próximo Ano")
    await user.type(screen.getByLabelText('Retorno Ano Atual (R$) — Janeiro'), '100')
    await user.type(screen.getByLabelText('Retorno Ano Atual (R$) — Fevereiro'), '250.50')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(acoesApi.createAcao).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'Ação de Teste',
          status: 'Planejado',
          retorno_ano_atual: 350.5,
          retorno_proximo_ano: 0,
          atual_janeiro: 100,
          atual_fevereiro: 250.5,
          atual_marco: 0,
        }),
      )
    });
  });

  it('só lista responsáveis ativos no formulário', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('Rightsizing VMs produção')

    await user.click(screen.getByRole('button', { name: 'Nova Ação' }))
    const select = screen.getByLabelText('Responsável') as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toContain('Ana Souza')
    expect(options).not.toContain('Inativo Silva');
  });
});

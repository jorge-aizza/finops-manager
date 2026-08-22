import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ProjetosView from './ProjetosView'
import * as projetosApi from '../api/projetos'
import type { Projeto } from '../types/projeto'

vi.mock('../api/projetos')

const mockProjetos: Projeto[] = [
  {
    id: 1,
    nome: 'Otimização EC2',
    diretoria: 'Tecnologia',
    descricao: 'Rightsizing de instâncias',
    status: 'Ativo',
    criado_em: '2026-01-15T12:00:00.000Z',
    atualizado_em: '2026-01-15T12:00:00.000Z',
  },
]

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjetosView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(projetosApi.listProjetos).mockResolvedValue(mockProjetos)
})

describe('ProjetosView', () => {
  it('lista os projetos vindos da API', async () => {
    renderWithClient()

    expect(screen.getByText('Carregando...')).toBeInTheDocument()
    expect(await screen.findByText('Otimização EC2')).toBeInTheDocument()
    expect(screen.getByText('Tecnologia')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
  });

  it('mostra estado vazio quando não há projetos', async () => {
    vi.mocked(projetosApi.listProjetos).mockResolvedValue([])
    renderWithClient()

    expect(await screen.findByText('Nenhum projeto cadastrado')).toBeInTheDocument()
  });

  it('cria um projeto novo e atualiza a lista', async () => {
    const user = userEvent.setup()
    vi.mocked(projetosApi.createProjeto).mockResolvedValue({
      ...mockProjetos[0],
      id: 2,
      nome: 'Projeto Novo',
    })

    renderWithClient()
    await screen.findByText('Otimização EC2')

    await user.click(screen.getByRole('button', { name: 'Novo Projeto' }))
    await user.type(screen.getByLabelText('Nome do Projeto *'), 'Projeto Novo')
    await user.click(screen.getByRole('button', { name: 'Salvar Projeto' }))

    await waitFor(() => {
      expect(projetosApi.createProjeto).toHaveBeenCalledWith({
        nome: 'Projeto Novo',
        diretoria: '',
        descricao: '',
      })
    });
  });
});

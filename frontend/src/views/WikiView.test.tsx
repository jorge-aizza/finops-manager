import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WikiView from './WikiView'
import * as wikiApi from '../api/wiki'

vi.mock('../api/wiki')

function renderWikiView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><WikiView /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.currentUser = { perfil: 'reader' }
  vi.mocked(wikiApi.listWikiPages).mockResolvedValue([])
  vi.mocked(wikiApi.listWikiCategories).mockResolvedValue([])
})

describe('WikiView', () => {
  it('renderiza a tela da base de conhecimento e o estado vazio', async () => {
    renderWikiView()

    expect(screen.getByText('Base de conhecimento')).toBeInTheDocument()
    expect(await screen.findByText('Nenhum artigo encontrado.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo artigo' })).not.toBeInTheDocument()
  })

  it('lista artigos e consulta a API ao pesquisar', async () => {
    const user = userEvent.setup()
    vi.mocked(wikiApi.listWikiPages).mockResolvedValue([{
      id: 1, slug: 'custos-azure', titulo: 'Custos Azure', categoria: 'Operação', resumo: 'Conferência mensal',
      status: 'publicado', atualizado_por: 'FinOps', atualizado_em: '2026-10-30T00:00:00Z',
    }])
    renderWikiView()

    expect(await screen.findByRole('button', { name: /Custos Azure/ })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Buscar artigos' }), 'custos')
    await waitFor(() => expect(wikiApi.listWikiPages).toHaveBeenLastCalledWith('custos', undefined))
  })

  it('mostra criação de artigos apenas para os perfis editores', () => {
    window.currentUser = { perfil: 'finops' }
    renderWikiView()

    expect(screen.getByRole('button', { name: 'Novo artigo' })).toBeInTheDocument()
  })
})
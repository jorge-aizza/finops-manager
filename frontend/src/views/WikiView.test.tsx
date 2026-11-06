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
      status: 'publicado', portal_publico: false, atualizado_por: 'FinOps', atualizado_em: '2026-10-30T00:00:00Z',
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

  it('mostra edição, arquivamento e exclusão ao abrir um artigo como editor', async () => {
    const user = userEvent.setup()
    window.currentUser = { perfil: 'finops' }
    const summary = {
      id: 8, slug: 'custos-azure', titulo: 'Custos Azure', categoria: 'Operação', resumo: null,
      status: 'publicado' as const, portal_publico: false, atualizado_por: 'FinOps', atualizado_em: '2026-10-30T00:00:00Z',
    }
    vi.mocked(wikiApi.listWikiPages).mockResolvedValue([summary])
    vi.mocked(wikiApi.getWikiPage).mockResolvedValue({
      ...summary, criado_por: 'FinOps', criado_em: summary.atualizado_em,
      conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conteúdo' }] }] },
    })
    renderWikiView()

    await user.click(await screen.findByRole('button', { name: /Custos Azure/ }))

    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arquivar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Histórico' })).toBeInTheDocument()
  })

  it('pré-visualiza o snapshot de uma revisão antes de qualquer restauração', async () => {
    const user = userEvent.setup()
    window.currentUser = { perfil: 'finops' }
    const summary = {
      id: 8, slug: 'custos-azure', titulo: 'Custos Azure', categoria: 'Operação', resumo: 'Resumo atual',
      status: 'publicado' as const, portal_publico: true, atualizado_por: 'FinOps', atualizado_em: '2026-10-30T00:00:00Z',
    }
    vi.mocked(wikiApi.listWikiPages).mockResolvedValue([summary])
    vi.mocked(wikiApi.getWikiPage).mockResolvedValue({
      ...summary, criado_por: 'FinOps', criado_em: summary.atualizado_em,
      conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conteúdo atual' }] }] },
    })
    vi.mocked(wikiApi.listWikiRevisions).mockResolvedValue([{
      id: 21, versao: 2, titulo: 'Custos Azure', categoria: 'Operação', resumo: 'Resumo anterior',
      status: 'publicado', portal_publico: false, alterado_por: 'Outro editor', alterado_em: '2026-10-29T00:00:00Z',
      conteudo: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conteúdo da versão anterior' }] }] },
    }])
    renderWikiView()

    await user.click(await screen.findByRole('button', { name: /Custos Azure/ }))
    await user.click(await screen.findByRole('button', { name: 'Histórico' }))
    await user.click(await screen.findByRole('button', { name: 'Prévia' }))

    expect(await screen.findByRole('heading', { name: 'Prévia da versão 2' })).toBeInTheDocument()
    expect(screen.getByText('Conteúdo da versão anterior')).toBeInTheDocument()
    expect(screen.getByText(/Resumo anterior/)).toBeInTheDocument()
    expect(screen.getByText(/Visibilidade pública/)).toBeInTheDocument()
    expect(screen.getByText('Novo (versão atual)')).toBeInTheDocument()
    expect(screen.getByText('Antigo (versão selecionada)')).toBeInTheDocument()
    const comparison = screen.getByRole('region', { name: 'Comparação do conteúdo' })
    const diffBody = comparison.querySelector('.wiki-revision-diff-body')
    expect(diffBody?.querySelector('ins')).toHaveTextContent('atual')
    expect(diffBody?.querySelector('del')).toHaveTextContent('da versão anterior')
    expect(wikiApi.restoreWikiRevision).not.toHaveBeenCalled()
  })
})
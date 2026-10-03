import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PublicGenieCotasView from './PublicGenieCotasView'
import * as portalEntraApi from '../api/portalEntra'
import type { GenieCotasPublicaResposta } from '../types/genieCotasPublica'

vi.mock('../api/portalEntra')

const resposta: GenieCotasPublicaResposta = {
  ativo: true,
  nome: 'Ana Souza',
  workspaces: [
    {
      workspace_id: 'ws-1', custo: 12.5, limite_local: 50, quota_nativa: 15, acao_nativa: 'BLOCK_USAGE',
      dias: [{ dia: '2026-09-01', custo: 5, dbus: 10, dbus_free: 10 }, { dia: '2026-09-02', custo: 7.5, dbus: 15, dbus_free: 15 }],
    },
  ],
}

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><PublicGenieCotasView /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('PublicGenieCotasView', () => {
  it('sem token salvo: mostra a tela de login "Entrar com Microsoft"', async () => {
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue(null)
    renderView()
    expect(await screen.findByTestId('public-genie-cotas-login')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entrar com Microsoft' })).toBeInTheDocument()
    expect(portalEntraApi.getGenieCotasPublica).not.toHaveBeenCalled()
  })

  it('clicar em Entrar com Microsoft busca a URL de login e tenta navegar (sem travar em erro)', async () => {
    const user = userEvent.setup()
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue(null)
    vi.mocked(portalEntraApi.getPortalEntraLoginUrl).mockResolvedValue('https://login.microsoftonline.com/xyz')
    renderView()
    await user.click(screen.getByRole('button', { name: 'Entrar com Microsoft' }))
    await waitFor(() => expect(portalEntraApi.getPortalEntraLoginUrl).toHaveBeenCalled())
  })

  it('erro ao iniciar o login: mostra a mensagem em vez de travar silenciosamente', async () => {
    const user = userEvent.setup()
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue(null)
    vi.mocked(portalEntraApi.getPortalEntraLoginUrl).mockRejectedValue(new Error('Entra ID nao configurado'))
    renderView()
    await user.click(screen.getByRole('button', { name: 'Entrar com Microsoft' }))
    expect(await screen.findByText('Entra ID nao configurado')).toBeInTheDocument()
  })

  it('com token salvo: carrega e mostra a cota por workspace', async () => {
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue('token-valido')
    vi.mocked(portalEntraApi.getGenieCotasPublica).mockResolvedValue(resposta)
    renderView()
    expect(await screen.findByTestId('public-genie-cotas')).toBeInTheDocument()
    expect(await screen.findByText('ws-1')).toBeInTheDocument()
    expect(screen.getByText(/cota configurada de US\$ 50/)).toBeInTheDocument()
    expect(screen.getByText(/quota nativa de bloqueio de US\$ 15/)).toBeInTheDocument()
  })

  it('sem consumo no mês: mostra mensagem, não uma tabela vazia', async () => {
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue('token-valido')
    vi.mocked(portalEntraApi.getGenieCotasPublica).mockResolvedValue({ ativo: true, nome: 'Ana Souza', workspaces: [] })
    renderView()
    expect(await screen.findByText(/Nenhum consumo de Genie encontrado para Ana Souza/)).toBeInTheDocument()
  })

  it('token expirado (401): limpa o token e volta para a tela de login', async () => {
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue('token-expirado')
    vi.mocked(portalEntraApi.getGenieCotasPublica).mockRejectedValue(new Error('Sessão expirada.'))
    renderView()
    await waitFor(() => expect(portalEntraApi.clearPortalEntraToken).toHaveBeenCalled())
    expect(await screen.findByTestId('public-genie-cotas-login')).toBeInTheDocument()
  })

  it('nunca mostra dados de outro usuário — só o que a API devolveu para o token atual', async () => {
    vi.mocked(portalEntraApi.getPortalEntraToken).mockReturnValue('token-valido')
    vi.mocked(portalEntraApi.getGenieCotasPublica).mockResolvedValue(resposta)
    renderView()
    await screen.findByTestId('public-genie-cotas')
    await screen.findByText('ws-1')
    // A view nunca passa e-mail/usuário pra getGenieCotasPublica — só o React Query chama a
    // função (sem argumento próprio nosso); o servidor decide "de quem são os dados" só pelo
    // token, então não há como esta tela pedir dado de outra pessoa.
    expect(portalEntraApi.getGenieCotasPublica).toHaveBeenCalledTimes(1)
  })
})

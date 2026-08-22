import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PortalApp from './PortalApp'
import * as portalApi from './api/portal'
import type { PortalConfig } from './types/portal'

vi.mock('./api/portal')

function makeConfig(overrides: Partial<PortalConfig> = {}): PortalConfig {
  return {
    titulo: 'Portal FinOps Vivo', descricao: 'Estime seus custos Azure.',
    dominios_aceitos: [], taxa_imposto: 18.65, taxa_cond: 13, taxa_gordura: 0,
    horario_livre: { ativo: false, inicio: '09:00', fim: '18:00', dias: [1, 2, 3, 4, 5] },
    solicitar_identificacao: false, permitir_selecao_periodo: true, permitir_selecao_recursos: true,
    ...overrides,
  }
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalApp />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  window.Calculadora = { init: vi.fn() }
})

describe('PortalApp', () => {
  it('mostra o estado de carregando antes da config chegar', async () => {
    vi.mocked(portalApi.getPortalConfig).mockReturnValue(new Promise(() => {}))
    renderWithClient()
    expect(screen.getByText('Carregando portal...')).toBeInTheDocument()
  });

  it('mostra "portal indisponível" quando a config falha (portal desativado)', async () => {
    vi.mocked(portalApi.getPortalConfig).mockRejectedValue(new Error('Portal desativado'))
    renderWithClient()
    expect(await screen.findByText('Portal temporariamente indisponível')).toBeInTheDocument()
  });

  it('sem identificação exigida: abre a calculadora direto (chama Calculadora.init)', async () => {
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: false }))
    renderWithClient()
    await waitFor(() => expect(window.Calculadora!.init).toHaveBeenCalledWith(
      expect.objectContaining({ apiBase: '/api/public/calculadora', publico: true }),
    ))
  });

  it('com identificação exigida: mostra o modal e não chama Calculadora.init até identificar', async () => {
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true }))
    renderWithClient()
    expect(await screen.findByText('Identificação')).toBeInTheDocument()
    expect(window.Calculadora!.init).not.toHaveBeenCalled()
  });

  it('preenche nome/email, identifica e então abre a calculadora', async () => {
    const user = userEvent.setup()
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true }))
    vi.mocked(portalApi.identificar).mockResolvedValue({ ok: true, nome: 'Ana Souza', email: 'ana@empresa.com' })
    renderWithClient()

    await screen.findByText('Identificação')
    await user.type(screen.getByLabelText('Nome completo'), 'Ana Souza')
    await user.type(screen.getByLabelText('E-mail corporativo'), 'ana@empresa.com')
    await user.click(screen.getByRole('button', { name: 'Confirmar e acessar' }))

    await waitFor(() => expect(portalApi.identificar).toHaveBeenCalledWith('Ana Souza', 'ana@empresa.com'))
    await waitFor(() => expect(window.Calculadora!.init).toHaveBeenCalled())
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
  });

  it('valida e-mail antes de submeter', async () => {
    const user = userEvent.setup()
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true }))
    renderWithClient()

    await screen.findByText('Identificação')
    await user.type(screen.getByLabelText('Nome completo'), 'Ana Souza')
    await user.type(screen.getByLabelText('E-mail corporativo'), 'nao-e-email')
    await user.click(screen.getByRole('button', { name: 'Confirmar e acessar' }))

    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument()
    expect(portalApi.identificar).not.toHaveBeenCalled()
  });

  it('alterna tema claro/escuro e persiste em localStorage', async () => {
    const user = userEvent.setup()
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig())
    renderWithClient()
    await waitFor(() => expect(window.Calculadora!.init).toHaveBeenCalled())

    const themeBtn = screen.getByTitle('Modo claro')
    await user.click(themeBtn)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('finops-theme')).toBe('light')
  });

  it('reaproveita sessão de identificação já salva em sessionStorage (não pede de novo)', async () => {
    sessionStorage.setItem('portal_ident', JSON.stringify({ nome: 'Carlos', email: 'carlos@empresa.com' }))
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true }))
    renderWithClient()

    await waitFor(() => expect(window.Calculadora!.init).toHaveBeenCalled())
    expect(screen.queryByText('Identificação')).not.toBeInTheDocument()
    expect(screen.getByText('Carlos')).toBeInTheDocument()
  });
});

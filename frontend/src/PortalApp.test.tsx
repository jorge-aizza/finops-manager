import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PortalApp from './PortalApp'
import * as portalApi from './api/portal'
import type { PortalConfig } from './types/portal'

vi.mock('./api/portal')

// PublicCalculadoraView (fluxo de consulta/estimativa em si) tem seus
// próprios testes — aqui só interessa SE ela monta, não o que tem dentro.
vi.mock('./views/PublicCalculadoraView', () => ({
  default: ({ cfg }: { cfg: PortalConfig }) => <div data-testid="public-calc">calculadora — {cfg.titulo}</div>,
}))

vi.mock('./views/PublicOrfaosView', () => ({
  default: () => <div data-testid="public-orfaos">órfãos</div>,
}))

vi.mock('./views/PublicGenieCotasView', () => ({
  default: () => <div data-testid="public-genie-cotas">cota genie</div>,
}))

function makeConfig(overrides: Partial<PortalConfig> = {}): PortalConfig {
  return {
    titulo: 'Portal FinOps Vivo', descricao: 'Estime seus custos Azure.',
    dominios_aceitos: [], taxa_imposto: 18.65, taxa_cond: 13, taxa_gordura: 0,
    imposto_microsoft: { ativo: false, taxa: 18.65 }, imposto_marketplace: { ativo: false, taxa: 18.65 },
    horario_livre: { ativo: false, inicio: '09:00', fim: '18:00', dias: [1, 2, 3, 4, 5], inicio_sab: '09:00', fim_sab: '18:00', inicio_dom: '09:00', fim_dom: '18:00' },
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
  window.location.hash = ''
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

  it('sem identificação exigida: abre a calculadora direto', async () => {
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: false }))
    renderWithClient()
    expect(await screen.findByTestId('public-calc')).toBeInTheDocument()
  });

  it('com identificação exigida: mostra o modal e não abre a calculadora até identificar', async () => {
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true }))
    renderWithClient()
    expect(await screen.findByText('Identificação')).toBeInTheDocument()
    expect(screen.queryByTestId('public-calc')).not.toBeInTheDocument()
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
    expect(await screen.findByTestId('public-calc')).toBeInTheDocument()
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
    await screen.findByTestId('public-calc')

    const themeBtn = screen.getByTitle('Modo claro')
    await user.click(themeBtn)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('finops-theme')).toBe('light')
  });

  it('reaproveita sessão de identificação já salva em sessionStorage (não pede de novo)', async () => {
    sessionStorage.setItem('portal_ident', JSON.stringify({ nome: 'Carlos', email: 'carlos@empresa.com' }))
    vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true }))
    renderWithClient()

    await screen.findByTestId('public-calc')
    expect(screen.queryByText('Identificação')).not.toBeInTheDocument()
    expect(screen.getByText('Carlos')).toBeInTheDocument()
  });

  describe('página inicial Portal de Serviços', () => {
    it('sem órfãos: abre direto na calculadora, sem início nem menu (como antes)', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: false }))
      renderWithClient()
      await screen.findByTestId('public-calc')
      expect(screen.queryByTestId('portal-home')).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Menu do portal' })).not.toBeInTheDocument()
    });

    it('com 2 serviços ativos: mostra a página inicial com os 2 cards e o menu', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true }))
      renderWithClient()
      expect(await screen.findByTestId('portal-home')).toBeInTheDocument()
      expect(screen.getByTestId('portal-card-calculadora')).toHaveAttribute('href', '#/calculadora')
      expect(screen.getByTestId('portal-card-orfaos')).toHaveAttribute('href', '#/orfaos')
      expect(screen.queryByTestId('public-calc')).not.toBeInTheDocument()
      expect(screen.getByRole('navigation', { name: 'Menu do portal' })).toBeInTheDocument()
    });

    it('clicar no card abre o serviço e o Voltar (hash) retorna ao início', async () => {
      const user = userEvent.setup()
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true }))
      renderWithClient()
      await screen.findByTestId('portal-home')

      await act(async () => { window.location.hash = '#/orfaos' })
      expect(await screen.findByTestId('public-orfaos')).toBeInTheDocument()
      expect(screen.queryByTestId('portal-home')).not.toBeInTheDocument()
      expect(screen.queryByText('Busca por Subscription', { exact: false })).not.toBeInTheDocument()

      await user.click(screen.getByRole('link', { name: 'Calculadora de Custos' }))
      expect(await screen.findByTestId('public-calc')).toBeInTheDocument()

      await user.click(screen.getByRole('link', { name: 'Início' }))
      expect(await screen.findByTestId('portal-home')).toBeInTheDocument()
    });

    it('trilha "← Portal de Serviços" só nas páginas de serviço com >1 serviço ativo', async () => {
      window.location.hash = '#/orfaos'
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true }))
      renderWithClient()
      await screen.findByTestId('public-orfaos')
      const trilha = screen.getByRole('navigation', { name: 'Você está em' })
      expect(trilha).toHaveTextContent('Portal de Serviços')
      expect(trilha).toHaveTextContent('Recursos Órfãos')
    });

    it('sem trilha na página inicial nem com um serviço só', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true }))
      const { unmount } = renderWithClient()
      await screen.findByTestId('portal-home')
      expect(screen.queryByRole('navigation', { name: 'Você está em' })).not.toBeInTheDocument()
      unmount()

      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: false }))
      renderWithClient()
      await screen.findByTestId('public-calc')
      expect(screen.queryByRole('navigation', { name: 'Você está em' })).not.toBeInTheDocument()
    });

    it('saúda pelo nome de quem se identificou e mostra o rodapé', async () => {
      sessionStorage.setItem('portal_ident', JSON.stringify({ nome: 'Carlos Lima', email: 'carlos@empresa.com' }))
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true, orfaos_ativo: true }))
      renderWithClient()
      expect(await screen.findByText('Olá, Carlos')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Dúvidas frequentes' })).toHaveAttribute('href', '/docs-portal-faq.html')
    });

    it('logo FinOps nas duas variantes de tema no cabeçalho', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig())
      const { container } = renderWithClient()
      await screen.findByTestId('public-calc')
      expect(container.querySelector('.portal-header img.topbar-logo-light')).toHaveAttribute('src', '/finops-logo.png')
      expect(container.querySelector('.portal-header img.topbar-logo-dark')).toHaveAttribute('src', '/finops-logo-dark.png')
    });

    it('deep link #/orfaos abre direto os órfãos', async () => {
      window.location.hash = '#/orfaos'
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true }))
      renderWithClient()
      expect(await screen.findByTestId('public-orfaos')).toBeInTheDocument()
    });

    it('só órfãos ativo (calculadora desligada): abre direto em órfãos, sem início nem menu', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true, calculadora_ativa: false }))
      renderWithClient()
      expect(await screen.findByTestId('public-orfaos')).toBeInTheDocument()
      expect(screen.queryByTestId('portal-home')).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Menu do portal' })).not.toBeInTheDocument()
    });

    it('rota de serviço desativado cai na página inicial (nunca abre o serviço)', async () => {
      window.location.hash = '#/orfaos'
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: false }))
      renderWithClient()
      expect(await screen.findByTestId('public-calc')).toBeInTheDocument()
      expect(screen.queryByTestId('public-orfaos')).not.toBeInTheDocument()
    });

    it('nenhum serviço ativo: mostra a mensagem', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: false, calculadora_ativa: false }))
      renderWithClient()
      expect(await screen.findByText('Nenhum serviço disponível')).toBeInTheDocument()
    });

    it('identificação exigida e ainda não feita: não mostra início, menu nem serviços', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ solicitar_identificacao: true, orfaos_ativo: true }))
      renderWithClient()
      await screen.findByText('Identificação')
      expect(screen.queryByTestId('portal-home')).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Menu do portal' })).not.toBeInTheDocument()
      expect(screen.queryByTestId('public-orfaos')).not.toBeInTheDocument()
    });
  });

  describe('serviço "Minha Cota Genie" (login pessoal via Entra ID)', () => {
    it('sem genie_cotas_ativo: não entra na home nem no menu', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true, genie_cotas_ativo: false }))
      renderWithClient()
      await screen.findByTestId('portal-home')
      expect(screen.queryByTestId('portal-card-genie-cotas')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Minha Cota Genie' })).not.toBeInTheDocument()
    });

    it('com genie_cotas_ativo junto de outro serviço: aparece na home e abre pelo menu', async () => {
      const user = userEvent.setup()
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true, genie_cotas_ativo: true }))
      renderWithClient()
      await screen.findByTestId('portal-home')

      expect(screen.getByTestId('portal-card-genie-cotas')).toHaveAttribute('href', '#/genie-cotas')
      await user.click(screen.getByRole('link', { name: 'Minha Cota Genie' }))
      expect(await screen.findByTestId('public-genie-cotas')).toBeInTheDocument()
    });

    it('só "Minha Cota Genie" ativo: abre direto nele, sem início nem menu', async () => {
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: false, calculadora_ativa: false, genie_cotas_ativo: true }))
      renderWithClient()
      expect(await screen.findByTestId('public-genie-cotas')).toBeInTheDocument()
      expect(screen.queryByTestId('portal-home')).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Menu do portal' })).not.toBeInTheDocument()
    });

    it('deep link #/genie-cotas abre direto a visão pessoal', async () => {
      window.location.hash = '#/genie-cotas'
      vi.mocked(portalApi.getPortalConfig).mockResolvedValue(makeConfig({ orfaos_ativo: true, genie_cotas_ativo: true }))
      renderWithClient()
      expect(await screen.findByTestId('public-genie-cotas')).toBeInTheDocument()
    });
  });
});

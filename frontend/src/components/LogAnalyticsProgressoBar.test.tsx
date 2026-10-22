import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LogAnalyticsProgressoBar from './LogAnalyticsProgressoBar'
import * as api from '../api/logAnalytics'

vi.mock('../api/logAnalytics')

const base = {
  tipo: 'ingestao_recurso' as const,
  fase: 'consultando ingestão por recurso',
  atual: 72, total: 191, detalhe: 'log-oracle-db',
  iniciado_em: '2026-10-20T19:00:00Z', concluido_em: null,
  erro: null, em_execucao: true, segundos: 62,
}

function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><LogAnalyticsProgressoBar /></QueryClientProvider>)
}

describe('LogAnalyticsProgressoBar', () => {
  beforeEach(() => vi.clearAllMocks())

  // Sem execução nenhuma o componente não pode ocupar espaço na tela — ele fica logo abaixo
  // dos botões, no meio do fluxo normal de leitura.
  it('não renderiza nada quando não há coleta', async () => {
    vi.mocked(api.getProgressoLogAnalytics).mockResolvedValue({ execucoes: [] })
    const { container } = renderBar()
    await vi.waitFor(() => expect(api.getProgressoLogAnalytics).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra fase, contagem, percentual e o item em processamento', async () => {
    vi.mocked(api.getProgressoLogAnalytics).mockResolvedValue({ execucoes: [base] })
    renderBar()
    const painel = await screen.findByRole('status')
    const dentro = within(painel)
    expect(dentro.getByText(/Atribuição por recurso/)).toBeInTheDocument()
    expect(dentro.getByText(/consultando ingestão por recurso/)).toBeInTheDocument()
    expect(dentro.getByText(/72 de 191/)).toBeInTheDocument()
    // 72/191 = 37,6% → arredonda pra 38
    expect(dentro.getByText(/38%/)).toBeInTheDocument()
    expect(dentro.getByText(/1min 2s/)).toBeInTheDocument()
    expect(dentro.getByText('log-oracle-db')).toBeInTheDocument()
  })

  // Enquanto a descoberta não termina não existe total. Fingir 0% daria a impressão de
  // travado; a barra fica indeterminada e o percentual some.
  it('sem total conhecido, não inventa percentual', async () => {
    vi.mocked(api.getProgressoLogAnalytics).mockResolvedValue({
      execucoes: [{ ...base, fase: 'descobrindo workspaces', atual: 0, total: 0, detalhe: null }],
    })
    renderBar()
    const painel = await screen.findByRole('status')
    expect(within(painel).getByText(/descobrindo workspaces/)).toBeInTheDocument()
    expect(within(painel).queryByText(/%/)).not.toBeInTheDocument()
    expect(within(painel).queryByText(/de 0/)).not.toBeInTheDocument()
  })

  // Concluída continua visível por alguns minutos (o servidor segura no TTL): sumir no
  // instante do fim é indistinguível de a tela ter perdido o estado.
  it('mostra o resultado de uma coleta concluída', async () => {
    vi.mocked(api.getProgressoLogAnalytics).mockResolvedValue({
      execucoes: [{
        ...base, fase: 'concluído', atual: 191, total: 191, em_execucao: false,
        concluido_em: '2026-10-20T19:10:00Z', detalhe: '191 workspace(s), 1.200 linha(s)', segundos: 600,
      }],
    })
    renderBar()
    const painel = await screen.findByRole('status')
    expect(within(painel).getByText(/concluído/)).toBeInTheDocument()
    expect(within(painel).getByText(/100%/)).toBeInTheDocument()
    expect(within(painel).getByText(/191 workspace\(s\), 1\.200 linha\(s\)/)).toBeInTheDocument()
  })

  // Falha precisa aparecer na tela, não só no log do servidor — era justamente o caso em que
  // o usuário ficava esperando por nada.
  it('mostra o erro quando a coleta falha', async () => {
    vi.mocked(api.getProgressoLogAnalytics).mockResolvedValue({
      execucoes: [{ ...base, fase: 'falhou', em_execucao: false, concluido_em: '2026-10-20T19:05:00Z', erro: 'token expirado' }],
    })
    renderBar()
    const painel = await screen.findByRole('status')
    expect(within(painel).getByText(/Falhou: token expirado/)).toBeInTheDocument()
  })

  it('lista as três coletas quando rodam juntas', async () => {
    vi.mocked(api.getProgressoLogAnalytics).mockResolvedValue({
      execucoes: [
        base,
        { ...base, tipo: 'coleta', fase: 'coletando workspaces', atual: 10, total: 191 },
        { ...base, tipo: 'diagnostic', fase: 'consultando Diagnostic Settings', atual: 500, total: 7141 },
      ],
    })
    renderBar()
    const paineis = await screen.findAllByRole('status')
    expect(paineis).toHaveLength(3)
    // Escopado por painel: "Diagnostic Settings" aparece tanto no rótulo quanto no texto da
    // fase, então uma busca global casaria dois elementos e falharia por ambiguidade.
    expect(within(paineis[0]).getByText(/Atribuição por recurso/)).toBeInTheDocument()
    expect(within(paineis[1]).getByText(/Coleta geral/)).toBeInTheDocument()
    expect(within(paineis[2]).getByText(/500 de 7141/)).toBeInTheDocument()
  })
})

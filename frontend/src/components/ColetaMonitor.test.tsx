import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ColetaMonitor from './ColetaMonitor'
import * as coletaApi from '../api/coleta'
import type { ColetaStatus, HistoricoItem } from '../types/coleta'

vi.mock('../api/coleta')

function statusBase(overrides: Partial<ColetaStatus> = {}): ColetaStatus {
  return {
    em_execucao: false, cancelando: false, progresso: null,
    ultimo: null, ultimo_api: null, ultimo_storage: null,
    agendador_ativo: true, circuit_breaker: { state: 'closed', failures: 0, open_until: null },
    ...overrides,
  }
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ColetaMonitor />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  window.showToast = vi.fn()
})

describe('ColetaMonitor', () => {
  it('sem coleta em andamento e sem histórico: não renderiza nada', async () => {
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(statusBase())
    const { container } = renderWithClient()
    await waitFor(() => expect(coletaApi.getColetaStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  });

  it('coleta em andamento: mostra fase, contadores e permite cancelar', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(statusBase({
      em_execucao: true,
      progresso: {
        tipo: 'api', fase: 'Buscando custos', sub_atual: 'Assinatura A', sub_idx: 1, sub_total: 2,
        chunk_atual: 3, chunk_total: 10, ins: 120, upd: 40, err: 0, log: [{ ts: '10:00:00', msg: 'Iniciado' }],
      },
    }))
    vi.mocked(coletaApi.cancelarColeta).mockResolvedValue({ ok: true, message: 'Cancelamento solicitado' })
    renderWithClient()

    expect(await screen.findByText(/Coleta em andamento/)).toBeInTheDocument()
    expect(screen.getByText(/Buscando custos/)).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(coletaApi.cancelarColeta).toHaveBeenCalled())
  });

  it('coleta finalizada: mostra estado final e some ao clicar em Fechar', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(statusBase({
      em_execucao: false,
      progresso: { tipo: 'api', fase: 'Finalizado com sucesso', ins: 500, upd: 10, err: 0, log: [] },
      ultimo_api: {
        id: 1, tipo: 'api', origem: 'api', iniciado_em: '2026-08-22T09:00:00.000Z', concluido_em: '2026-08-22T09:05:00.000Z',
        status: 'concluido', linhas_inseridas: 500, linhas_atualizadas: 10, linhas_erro: 0, mensagem: null, detalhes: null,
        periodo_inicio: null, periodo_fim: null, validacao_status: null, validacao_json: null, sp_nome: 'SP Produção',
      },
    }))
    renderWithClient()

    expect(await screen.findByText(/Finalizado com sucesso/)).toBeInTheDocument()
    expect(screen.getByText(/✅ Concluído/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByText(/Finalizado com sucesso/)).not.toBeInTheDocument())
  });
});

const ultimoApi: HistoricoItem = {
  id: 42, tipo: 'api', origem: 'api', iniciado_em: '2026-08-22T10:00:00.000Z',
  concluido_em: '2026-08-22T10:05:00.000Z', status: 'concluido',
  linhas_inseridas: 27063, linhas_atualizadas: 0, linhas_erro: 0, mensagem: null, detalhes: null,
  periodo_inicio: '2026-08-22', periodo_fim: '2026-08-22', validacao_status: null, validacao_json: null, sp_nome: 'SP Produção',
}

function statusFinalizado(overrides: Partial<ColetaStatus> = {}): ColetaStatus {
  return statusBase({
    progresso: {
      tipo: 'api', fase: 'Concluído — 76461b8e-edbd-464c-ad30-b13ba994709c (2/2 assinaturas)',
      ins: 27063, upd: 0, err: 0,
      log: [{ ts: '14:32:07', msg: 'Coleta finalizada' }],
    },
    ultimo: ultimoApi, ultimo_api: ultimoApi,
    ...overrides,
  })
}

// Bug real reportado pelo usuário: o card de progresso reaparecia mesmo depois de
// clicar "Fechar", em qualquer entrada nova no sistema ou F5 — porque o "fechado"
// só vivia num useState (perdido a cada remount), enquanto o servidor continua
// devolvendo o mesmo job concluído em GET /azure-coleta/status até uma coleta nova
// rodar. Fix: persistir a chave do job fechado em localStorage.
describe('ColetaMonitor — "Fechar" precisa sobreviver a reload/remount', () => {
  it('mostra o card de um job concluído e some ao clicar Fechar', async () => {
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(statusFinalizado())
    renderWithClient()
    expect(await screen.findByText('✅ Concluído — API Oficial')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByText('✅ Concluído — API Oficial')).not.toBeInTheDocument())
  })

  it('persiste o fechamento em localStorage e um remount (F5/nova sessão) não reabre o mesmo job', async () => {
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(statusFinalizado())
    const { unmount } = renderWithClient()
    await screen.findByText('✅ Concluído — API Oficial')
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByText('✅ Concluído — API Oficial')).not.toBeInTheDocument())
    expect(localStorage.getItem('coleta_monitor_dismissed')).toBe('api:42')

    unmount()
    renderWithClient() // simula reentrar no app / F5 — mesmo job (id 42) ainda vem do servidor
    await waitFor(() => expect(screen.queryByText('✅ Concluído — API Oficial')).not.toBeInTheDocument())
  })

  it('um job novo (id diferente) reabre o card mesmo com um fechamento antigo persistido', async () => {
    localStorage.setItem('coleta_monitor_dismissed', 'api:42') // job anterior já fechado antes
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(
      statusFinalizado({ ultimo_api: { ...ultimoApi, id: 43 } }),
    )
    renderWithClient()
    expect(await screen.findByText('✅ Concluído — API Oficial')).toBeInTheDocument()
  })

  it('renderiza o horário do log como veio do servidor (HH:MM:SS), sem tentar reparsear como Date', async () => {
    vi.mocked(coletaApi.getColetaStatus).mockResolvedValue(statusFinalizado())
    renderWithClient()
    expect(await screen.findByText('[14:32:07] Coleta finalizada')).toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
  })
})

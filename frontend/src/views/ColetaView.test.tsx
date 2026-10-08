import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ColetaView from './ColetaView'
import * as coletaApi from '../api/coleta'
import * as databricksColetaApi from '../api/databricksColeta'
import type { CoberturaMes, HistoricoItem, Pendente, ServicePrincipal, StorageConfig } from '../types/coleta'

vi.mock('../api/coleta')
vi.mock('../api/databricksColeta')

const mockSPs: ServicePrincipal[] = [
  {
    id: 1, nome: 'SP Produção', tenant_id: 'tenant-abcdefgh-1234', client_id: 'client-abcdefgh-1234',
    ativo: true, is_padrao: true, expiracao_secret: '2027-01-01', billing_account_id: 'BA-1',
    billing_profile_id: 'BP-1', modo_coleta: 'billing_profile', subscription_ids: null,
    granularidade_dias: 7, dia_execucao: 5, hora_execucao: null, dias_semana: null,
    auto_coleta: true, proxima_coleta: null, atualizado_em: '2026-01-01T00:00:00.000Z',
  },
]

const mockStorages: StorageConfig[] = [
  {
    id: 1, nome: 'Storage Principal', storage_account: 'stfinops', storage_container: 'billing',
    storage_prefix: '', price_list_prefix: null, ativo: true, sp_id: 1,
    criado_em: '2026-01-01T00:00:00.000Z', atualizado_em: '2026-01-01T00:00:00.000Z',
  },
]

const mockCobertura: CoberturaMes[] = [
  {
    mes: '2026-08-01', subscription_id: 'sub-1', subscription_name: 'Sub Principal',
    registros: 1200, dias_com_dados: 20, dias_no_mes: 31, ultima_importacao: '2026-08-20', total_brl: 5000,
  },
]

const mockHistorico: HistoricoItem[] = [
  {
    id: 1, tipo: 'api', origem: 'manual', iniciado_em: '2026-08-20T10:00:00.000Z', concluido_em: '2026-08-20T10:05:00.000Z',
    status: 'concluido', linhas_inseridas: 100, linhas_atualizadas: 20, linhas_erro: 0,
    mensagem: null, detalhes: { log: [{ ts: '10:00:00', msg: 'Iniciado' }, { ts: '10:05:00', msg: 'Concluído com sucesso' }] },
    periodo_inicio: '2026-08-01', periodo_fim: '2026-08-20',
    validacao_status: 'ok',
    validacao_json: {
      total_registros: 5000, custo_total: 12000, dias_com_dados: 20, dias_esperados: 20,
      subs_com_dados: 1, subs_esperadas: 1, subs_sem_dados: [], dias_sem_dados: [], validado_em: '2026-08-20T10:06:00.000Z',
    },
    sp_nome: 'SP Produção',
  },
  {
    id: 2, tipo: 'api', origem: 'agendado', iniciado_em: '2026-08-21T02:00:00.000Z', concluido_em: '2026-08-21T02:00:30.000Z',
    status: 'concluido', linhas_inseridas: 50, linhas_atualizadas: 5, linhas_erro: 0,
    mensagem: null, detalhes: null, periodo_inicio: '2026-08-21', periodo_fim: '2026-08-21',
    validacao_status: null, validacao_json: null, sp_nome: 'SP Produção',
  },
]

const mockPendentes: Pendente[] = []

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ColetaView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(coletaApi.listSPs).mockResolvedValue(mockSPs)
  vi.mocked(coletaApi.listStorages).mockResolvedValue(mockStorages)
  vi.mocked(coletaApi.getCoberturaMeses).mockResolvedValue(mockCobertura)
  vi.mocked(coletaApi.getHistorico).mockResolvedValue(mockHistorico)
  vi.mocked(coletaApi.getImports).mockResolvedValue([])
  vi.mocked(coletaApi.listPendentes).mockResolvedValue(mockPendentes)
  vi.mocked(coletaApi.getColetaStatus).mockResolvedValue({
    em_execucao: false, cancelando: false, progresso: null, execucoes: [],
    ultimo: null, ultimo_api: null, ultimo_storage: null,
    agendador_ativo: true, circuit_breaker: { state: 'closed', failures: 0, open_until: null },
  })
  vi.mocked(databricksColetaApi.listDatabricksConfigs).mockResolvedValue([])
  vi.mocked(databricksColetaApi.getDatabricksStatus).mockResolvedValue({
    em_execucao: false, iniciada_em: null, progresso: { fase: '', ins: 0, upd: 0, err: 0, log: [] },
  })
  vi.mocked(databricksColetaApi.getDatabricksHistorico).mockResolvedValue([])
  window.showToast = vi.fn()
})

describe('ColetaView', () => {
  it('lista os Service Principals vindos da API', async () => {
    renderWithClient()
    const row = (await screen.findByText('PADRÃO')).closest('tr')!
    expect(row).toHaveTextContent('SP Produção')
  });

  it('lista os Storage Accounts vindos da API', async () => {
    renderWithClient()
    expect(await screen.findByText('Storage Principal')).toBeInTheDocument()
    expect(screen.getByText('stfinops')).toBeInTheDocument()
  });

  it('renderiza a grade de cobertura por mês', async () => {
    renderWithClient()
    const cell = await screen.findByTitle('65% de cobertura — 1.200 registros')
    expect(cell).toHaveTextContent('65%')
  });

  it('lista o histórico de execuções (aba API)', async () => {
    renderWithClient()
    expect(await screen.findAllByText('concluido')).toHaveLength(2)
  });

  it('cria um novo Service Principal', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.createSP).mockResolvedValue({ ok: true })
    renderWithClient()
    await screen.findByText('PADRÃO')

    await user.click(screen.getByRole('button', { name: 'Novo SP' }))
    await user.type(screen.getByLabelText('Nome *'), 'SP Teste')
    await user.type(screen.getByLabelText('Tenant ID *'), 'tenant-teste')
    await user.type(screen.getByLabelText('Client ID *'), 'client-teste')
    await user.type(screen.getByLabelText('Billing Account ID *'), 'BA-2')
    await user.type(screen.getByLabelText('Billing Profile ID *'), 'BP-2')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(coletaApi.createSP).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'SP Teste', tenant_id: 'tenant-teste', client_id: 'client-teste' }),
      )
    });
  });

  it('exclui um Storage Account após confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(coletaApi.deleteStorage).mockResolvedValue({ ok: true })
    renderWithClient()
    const row = (await screen.findByText('Storage Principal')).closest('tr')!

    await user.click(within(row).getByTitle('Excluir'))

    await waitFor(() => expect(coletaApi.deleteStorage).toHaveBeenCalledWith(1))
  });

  it('"Testar credenciais" chama testarSP e mostra o resultado num toast', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.testarSP).mockResolvedValue({
      ok: true, message: 'Azure Management API ✅\nAzure Storage ✅',
      results: { management: { ok: true, msg: 'Azure Management API ✅' }, storage: { ok: true, msg: 'Azure Storage ✅' } },
    })
    renderWithClient()
    const row = (await screen.findByText('PADRÃO')).closest('tr')!

    await user.click(within(row).getByTitle('Testar credenciais'))

    await waitFor(() => expect(coletaApi.testarSP).toHaveBeenCalledWith(1))
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Azure Management API'), 'success')
  });

  it('"Testar acesso" (Storage) chama testarStorage e mostra o total de arquivos', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.testarStorage).mockResolvedValue({ ok: true, total: 42, totalSizeMB: '12.3', preview: [] })
    renderWithClient()
    const row = (await screen.findByText('Storage Principal')).closest('tr')!

    await user.click(within(row).getByTitle('Testar acesso'))

    await waitFor(() => expect(coletaApi.testarStorage).toHaveBeenCalledWith(1))
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('42'), 'success')
  });

  it('"Executar agora" (Storage) chama executarStorage', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.executarStorage).mockResolvedValue({ ok: true, message: 'Coleta Storage iniciada' })
    renderWithClient()
    const row = (await screen.findByText('Storage Principal')).closest('tr')!

    await user.click(within(row).getByTitle('Executar agora'))

    await waitFor(() => expect(coletaApi.executarStorage).toHaveBeenCalledWith(1))
  });

  it('"Iniciar Coleta" abre o wizard, "Agendamento" abre o modal de agendamento, "Diagnóstico" abre o painel', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getDiagAgendador).mockResolvedValue({
      agora_node: '', agora_node_local: '', tz_process: '', coleta_em_execucao: false, agendador_ativo: true,
      api_sps: [], storage_sps: [],
    })
    renderWithClient()
    const row = (await screen.findByText('PADRÃO')).closest('tr')!

    await user.click(within(row).getByTitle('Iniciar Coleta'))
    expect(await screen.findByText('Nova Coleta via API — SP Produção')).toBeInTheDocument()
    await user.click(screen.getByText('✕'))

    await user.click(within(row).getByTitle('Agendamento'))
    expect(await screen.findByText('Agendamento — SP Produção')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await user.click(screen.getByRole('button', { name: '🔍 Diagnóstico do Agendador' }))
    expect(await screen.findByText('Nenhuma SP')).toBeInTheDocument()
  });

  it('ação "▶" na grade de Cobertura pede confirmação e chama coletarAPI escopado pro mês/assinatura', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(coletaApi.coletarAPI).mockResolvedValue({ ok: true, message: 'Coleta iniciada' })
    renderWithClient()

    const cell = await screen.findByTitle('65% de cobertura — 1.200 registros')
    await user.click(cell)
    await user.click(await screen.findByTitle('Coletar agora este mês/assinatura'))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Sub Principal'))
    await waitFor(() => expect(coletaApi.coletarAPI).toHaveBeenCalledWith(1, expect.objectContaining({
      modo: 'subscription', subscription_ids: ['sub-1'], data_inicio: '2026-08-01', data_fim: '2026-08-31',
    })))
  });

  it('ação "📅" na grade de Cobertura chama criarPendente e cancela se o usuário não confirmar', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithClient()

    const cell = await screen.findByTitle('65% de cobertura — 1.200 registros')
    await user.click(cell)
    await user.click(await screen.findByTitle('Incluir no próximo agendamento'))

    expect(confirmSpy).toHaveBeenCalled()
    expect(coletaApi.criarPendente).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    vi.mocked(coletaApi.criarPendente).mockResolvedValue({ ok: true })
    await user.click(screen.getByTitle('Incluir no próximo agendamento'))

    await waitFor(() => expect(coletaApi.criarPendente).toHaveBeenCalledWith(expect.objectContaining({
      sp_id: 1, subscription_id: 'sub-1', sub_name: 'Sub Principal', data_inicio: '2026-08-01', data_fim: '2026-08-31',
    })))
  });

  // Colunas Origem/Duração/Validação/Log restauradas no Histórico de Execuções —
  // tinham sido perdidas na migração (achado numa auditoria completa comparando
  // app.js contra o React), não existia jeito de auditar uma execução passada.
  describe('Histórico de Execuções — Origem/Duração/Validação/Log', () => {
    it('mostra badge de Origem e a Duração calculada de cada execução', async () => {
      renderWithClient()

      expect(await screen.findByText('👤 Manual')).toBeInTheDocument()
      expect(screen.getByText('⏰ Agendada')).toBeInTheDocument()
      expect(screen.getByText('5m 0s')).toBeInTheDocument() // linha 1: 10:00:00 → 10:05:00
      expect(screen.getByText('30s')).toBeInTheDocument() // linha 2: 02:00:00 → 02:00:30
    });

    it('botão "Log" abre o log passo a passo; sem log mostra "—"', async () => {
      const user = userEvent.setup()
      renderWithClient()
      await screen.findByText('👤 Manual')

      expect(screen.getAllByText('—').length).toBeGreaterThan(0) // linha 2 não tem log/validação
      await user.click(screen.getByRole('button', { name: '📋 Log' }))

      expect(await screen.findByText('Log da Coleta #1')).toBeInTheDocument()
      expect(screen.getByText('Iniciado')).toBeInTheDocument()
      expect(screen.getByText('Concluído com sucesso')).toBeInTheDocument()
    });

    it('botão "✅ OK" abre a validação com os números registrados', async () => {
      const user = userEvent.setup()
      renderWithClient()
      await screen.findByText('👤 Manual')

      await user.click(screen.getByRole('button', { name: /✅ OK/ }))
      const modal = (await screen.findByText('Validação — Coleta #1')).closest<HTMLElement>('.modal')!
      expect(within(modal).getByText('5.000')).toBeInTheDocument() // total_registros
      expect(within(modal).getByText('20 / 20')).toBeInTheDocument() // dias_com_dados/esperados
    });

    it('linha sem validação nenhuma não mostra botão de Validação (mesmo comportamento do legado)', async () => {
      renderWithClient()
      await screen.findByText('👤 Manual')
      // linha 2 (id=2) tem validacao_status null — sem botão, só "—" na coluna
      expect(screen.queryByRole('button', { name: /Validar agora/ })).not.toBeInTheDocument()
    });
  });

  describe('Histórico de Execuções — aba "Coleta Databricks"', () => {
    it('busca de databricks_coleta_historico (não azure_coleta_historico) ao trocar de aba', async () => {
      const user = userEvent.setup()
      vi.mocked(databricksColetaApi.getDatabricksHistorico).mockResolvedValue([
        {
          id: 9, tipo: null, origem: 'manual', iniciado_em: '2026-08-25T22:27:24.000Z', concluido_em: '2026-08-25T22:30:00.000Z',
          status: 'concluido', linhas_inseridas: 300, linhas_atualizadas: 10, linhas_erro: 0,
          mensagem: 'Databricks — 310 linha(s)', detalhes: null, periodo_inicio: '2026-08-01', periodo_fim: '2026-08-25',
          validacao_status: null, validacao_json: null, sp_nome: 'Databricks Principal',
        },
      ])
      renderWithClient()
      await screen.findByText('👤 Manual') // aba API já carregada (default)

      await user.selectOptions(screen.getByRole('combobox'), 'databricks')

      expect(await screen.findByText('Databricks Principal')).toBeInTheDocument()
      expect(screen.getByText('Configuração')).toBeInTheDocument() // header trocado de "SP"
      expect(databricksColetaApi.getDatabricksHistorico).toHaveBeenCalled()
    });

    it('"Limpar" na aba Databricks chama deleteDatabricksHistorico, não deleteHistorico (Azure)', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(databricksColetaApi.deleteDatabricksHistorico).mockResolvedValue({ ok: true })
      renderWithClient()
      await screen.findByText('👤 Manual')

      await user.selectOptions(screen.getByRole('combobox'), 'databricks')
      await screen.findByText('Configuração')
      await user.click(screen.getByRole('button', { name: 'Limpar' }))

      await waitFor(() => expect(databricksColetaApi.deleteDatabricksHistorico).toHaveBeenCalled())
      expect(coletaApi.deleteHistorico).not.toHaveBeenCalled()
    });
  });
});

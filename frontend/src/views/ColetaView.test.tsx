import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TenantFilterProvider } from '../contexts/TenantFilterContext'
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
      <TenantFilterProvider>
        <ColetaView />
      </TenantFilterProvider>
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

  // ── Coletar Todas (v4.2) ──
  describe('Coletar Todas', () => {
    const planoDuasSps = {
      periodo_customizado: false,
      aptas: [
        { id: 1, nome: 'SP Produção', modo: 'billing_profile' as const, assinaturas: 0, data_inicio: '2026-10-08', data_fim: '2026-10-14' },
        { id: 2, nome: 'SP BigData', modo: 'subscription' as const, assinaturas: 12, data_inicio: '2026-10-08', data_fim: '2026-10-14' },
      ],
      inaptas: [],
    }

    it('mostra o plano na confirmação antes de disparar nada', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      vi.mocked(coletaApi.previewColetarTodas).mockResolvedValue(planoDuasSps)
      renderWithClient()
      await screen.findByText('PADRÃO')

      await user.click(screen.getByRole('button', { name: '⏩ Coletar Todas' }))

      await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
      const msg = confirmSpy.mock.calls[0][0] as string
      // O alcance precisa estar explícito: quantas SPs, quais, e o período de cada uma.
      expect(msg).toContain('2 Service Principal')
      expect(msg).toContain('SP Produção')
      expect(msg).toContain('SP BigData')
      expect(msg).toContain('12 assinatura(s)')
      expect(msg).toContain('2026-10-08 → 2026-10-14')
      // Recusou: não dispara.
      expect(coletaApi.coletarTodas).not.toHaveBeenCalled()
    });

    it('dispara a coleta ao confirmar', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewColetarTodas).mockResolvedValue(planoDuasSps)
      vi.mocked(coletaApi.coletarTodas).mockResolvedValue({
        ok: true, message: 'Coleta iniciada em 2 Service Principal(is)',
        iniciadas: planoDuasSps.aptas, inaptas: [],
      })
      renderWithClient()
      await screen.findByText('PADRÃO')

      await user.click(screen.getByRole('button', { name: '⏩ Coletar Todas' }))

      await waitFor(() => expect(coletaApi.coletarTodas).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('2 Service Principal(is)'), 'success',
      ))
    });

    it('avisa quais SPs foram ignoradas, sem esconder que as outras rodaram', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const inaptas = [{ id: 3, nome: 'SP Velha', motivo: 'já está coletando agora' }]
      vi.mocked(coletaApi.previewColetarTodas).mockResolvedValue({ ...planoDuasSps, inaptas })
      vi.mocked(coletaApi.coletarTodas).mockResolvedValue({
        ok: true, message: 'Coleta iniciada em 2 Service Principal(is)',
        iniciadas: planoDuasSps.aptas, inaptas,
      })
      renderWithClient()
      await screen.findByText('PADRÃO')

      await user.click(screen.getByRole('button', { name: '⏩ Coletar Todas' }))

      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('1 ignorada(s)'), 'success',
      ))
    });

    it('não chama o POST quando nenhuma SP está apta', async () => {
      const user = userEvent.setup()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewColetarTodas).mockResolvedValue({
        periodo_customizado: false, aptas: [],
        inaptas: [{ id: 1, nome: 'SP Produção', motivo: 'sem assinaturas configuradas e sem Billing Profile' }],
      })
      renderWithClient()
      await screen.findByText('PADRÃO')

      await user.click(screen.getByRole('button', { name: '⏩ Coletar Todas' }))

      await waitFor(() => expect(alertSpy).toHaveBeenCalled())
      expect(alertSpy.mock.calls[0][0]).toContain('sem assinaturas configuradas')
      expect(confirmSpy).not.toHaveBeenCalled() // não pede confirmação do que não dá pra fazer
      expect(coletaApi.coletarTodas).not.toHaveBeenCalled()
    });

    it('não dispara se o preview falhar — o usuário não confirma o que não viu', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewColetarTodas).mockRejectedValue(new Error('500 banco fora'))
      renderWithClient()
      await screen.findByText('PADRÃO')

      await user.click(screen.getByRole('button', { name: '⏩ Coletar Todas' }))

      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('500 banco fora'), 'error',
      ))
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(coletaApi.coletarTodas).not.toHaveBeenCalled()
    });
  });

  // ── Reprocessar Mês ──
  describe('Reprocessar Mês', () => {
    const planoUmaSp = {
      mes: '2026-08', inicio: '2026-08-01', fim: '2026-08-31', dias_esperados: 31,
      por_sp: [
        {
          sp_id: 1, sp_nome: 'SP Produção', ja_em_execucao: false,
          assinaturas: [{ subscription_id: 'sub-1', subscription_name: 'Sub Principal', dias_com_dados: 20 }],
        },
      ],
    }

    async function abrirDetalheMes(user: ReturnType<typeof userEvent.setup>) {
      renderWithClient()
      const cell = await screen.findByTitle('65% de cobertura — 1.200 registros')
      await user.click(cell)
      await screen.findByText('Detalhe — 2026-08')
    }

    it('mostra o plano por SP na confirmação antes de disparar nada', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      vi.mocked(coletaApi.previewReprocessarMes).mockResolvedValue(planoUmaSp)
      await abrirDetalheMes(user)

      await user.click(screen.getByRole('button', { name: /Reprocessar mês/ }))

      await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
      const msg = confirmSpy.mock.calls[0][0] as string
      expect(msg).toContain('2026-08')
      expect(msg).toContain('2026-08-01')
      expect(msg).toContain('2026-08-31')
      expect(msg).toContain('SP Produção')
      expect(msg).toContain('Sub Principal')
      expect(msg).toContain('20/31')
      expect(coletaApi.reprocessarMes).not.toHaveBeenCalled()
    });

    it('dispara o reprocessamento ao confirmar', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewReprocessarMes).mockResolvedValue(planoUmaSp)
      vi.mocked(coletaApi.reprocessarMes).mockResolvedValue({
        ok: true, message: 'Reprocessamento de 2026-08 iniciado em 1 Service Principal(is)',
        mes: '2026-08', inicio: '2026-08-01', fim: '2026-08-31',
        iniciadas: planoUmaSp.por_sp.map(({ ja_em_execucao, ...pub }) => pub), puladas: [],
      })
      await abrirDetalheMes(user)

      await user.click(screen.getByRole('button', { name: /Reprocessar mês/ }))

      await waitFor(() => expect(coletaApi.reprocessarMes).toHaveBeenCalledWith('2026-08'))
      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Reprocessamento de 2026-08 iniciado'), 'success',
      ))
    });

    it('avisa quais SPs já estavam coletando e foram puladas, sem esconder o resto', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewReprocessarMes).mockResolvedValue(planoUmaSp)
      vi.mocked(coletaApi.reprocessarMes).mockResolvedValue({
        ok: true, message: 'Reprocessamento de 2026-08 iniciado em 0 Service Principal(is)',
        mes: '2026-08', inicio: '2026-08-01', fim: '2026-08-31',
        iniciadas: [], puladas: [{ sp_id: 1, sp_nome: 'SP Produção', assinaturas: planoUmaSp.por_sp[0].assinaturas }],
      })
      await abrirDetalheMes(user)

      await user.click(screen.getByRole('button', { name: /Reprocessar mês/ }))

      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('1 SP ignorada(s)'), 'success',
      ))
    });

    it('não pede confirmação quando não há buraco detectável no mês', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewReprocessarMes).mockResolvedValue({ ...planoUmaSp, por_sp: [] })
      await abrirDetalheMes(user)

      await user.click(screen.getByRole('button', { name: /Reprocessar mês/ }))

      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Nenhum buraco detectável'), 'success',
      ))
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(coletaApi.reprocessarMes).not.toHaveBeenCalled()
    });

    it('não dispara se o preview falhar', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(coletaApi.previewReprocessarMes).mockRejectedValue(new Error('timeout'))
      await abrirDetalheMes(user)

      await user.click(screen.getByRole('button', { name: /Reprocessar mês/ }))

      await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
        expect.stringContaining('timeout'), 'error',
      ))
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(coletaApi.reprocessarMes).not.toHaveBeenCalled()
    });
  });
});

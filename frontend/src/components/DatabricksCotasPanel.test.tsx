import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatabricksCotasPanel from './DatabricksCotasPanel'
import * as api from '../api/databricksColeta'
import * as genieApi from '../api/genieBudgets'
import type { DatabricksCotas, DatabricksCotaWorkspace } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')
vi.mock('../api/genieBudgets')

// Genie e free-tier: custo zero, so DBU -- e assim que a serie chega na tela
const serie = (dias: string[]) => ({
  workspace: dias.map((dia, i) => ({ dia, custo: 0, dbus: 100 + i * 10, dbus_free: 100 + i * 10 })),
  usuario: dias.map((dia, i) => ({ dia, custo: 0, dbus: 50 + i * 5, dbus_free: 50 + i * 5 })),
  // SQL sempre maior que JOBS: fixa a ordem da pilha e da legenda
  produto: dias.flatMap((dia) => [
    { produto: 'SQL', dia, custo: 0, dbus: 80 },
    { produto: 'JOBS', dia, custo: 0, dbus: 20 },
  ]),
})

const cotas = (over: Partial<DatabricksCotas> = {}): DatabricksCotas => ({
  mes: '2026-08',
  meses_disponiveis: ['2026-08', '2026-07'],
  meses_considerados: 1,
  por_workspace: [
    { workspace_id: 'ws-dev', custo: 6853.08, dbus: 100, dbus_free: 10, dbus_pago: 90, cota: 7000, pct: 97.9, budget_nome: 'Quota Dev', status: 'critico' },
    { workspace_id: 'ws-sem', custo: 1200, dbus: 20, dbus_free: 0, dbus_pago: 20, cota: null, pct: null, budget_nome: null, status: 'sem_cota' },
  ],
  por_usuario: [
    { workspace_id: 'ws-dev', usuario: 'pedro@vivo.com.br', custo: 1786.79, dbus: 50, dbus_free: 5, dbus_pago: 45, limite: 400, pct: 446.7, origem_limite: 'workspace', budget_nome: 'Teto por usuário', status: 'estourado' },
    { workspace_id: 'ws-dev', usuario: 'ana@vivo.com.br', custo: 120, dbus: 8, dbus_free: 0, dbus_pago: 8, limite: 400, pct: 30, origem_limite: 'individual', budget_nome: 'Exceção Ana', status: 'ok' },
  ],
  resumo: { custo_total: 8053.08, cota_total: 7000, workspaces_sem_cota: 1, usuarios_acima_do_limite: 1 },
  ...over,
})

const nomeWorkspace = (id: string) => id === 'ws-dev' ? 'Desenvolvimento'
  : id === 'ws-sem' ? 'Sandbox'
    : `Ambiente ${id.replace(/^ws-/, '')}`

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><DatabricksCotasPanel /></QueryClientProvider>)
}

const cartao = (prefixo: string, nome: string) =>
  screen.getByRole('button', { name: `Ver detalhes de ${prefixo} ${nome}` })

describe('DatabricksCotasPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.getDatabricksGenieCotasInternas).mockResolvedValue({ periodo: 'month', workspaces: [], usuarios: [] })
    vi.mocked(genieApi.listGenieBudgets).mockResolvedValue({ budgets: [], account_total: 0, genie_total: 0 })
    vi.mocked(genieApi.listGenieWorkspaces).mockImplementation(async (ids = []) =>
      ids.map((workspace_id) => ({ workspace_id, nome: nomeWorkspace(workspace_id) })))
  })

  it('mostra o semáforo por workspace e por usuário com consumo, teto e percentual', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('Cotas Workspace')).toBeInTheDocument()
    expect(screen.queryByText('ws-dev')).not.toBeInTheDocument()
    expect(screen.getByText('Cotas Usuário')).toBeInTheDocument()

    // percentual no formato do cockpit: no maximo 2 casas, sem minimo --
    // 97,9% e nao 97,90%, e o teto sai como US$ 7.000 (sem ",00")
    expect(screen.getByText('97,9%')).toBeInTheDocument()
    expect(screen.getByText(/US\$ 6\.853,08 consumidos · 100 DBU · de US\$ 7\.000 disponíveis/)).toBeInTheDocument()

    // usuário estourado acima de 100% mostra o valor real, não saturado em 100
    expect(screen.getByText('446,7%')).toBeInTheDocument()
    // o cockpit nao tem um estado "estourado" proprio: acima de 100% segue
    // sendo Critico. O servidor continua distinguindo os dois (o alerta por
    // e-mail depende disso) -- so a apresentacao e que unifica.
    expect(screen.getAllByText('Crítico')).toHaveLength(2)
    expect(screen.getByText('Normal')).toBeInTheDocument()
  })

  it('solicita todos os workspaces Genie para filtrar no portal', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    await screen.findByText('Cotas Workspace')

    expect(api.getDatabricksCotas).toHaveBeenCalledWith(
      expect.objectContaining({ data_inicio: expect.any(String), data_fim: expect.any(String) }),
      true,
      true,
    )
  })

  it('exibe avisos quando uma das conexões Genie falha e o snapshot é parcial', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksGenieCotasInternas).mockResolvedValue({
      periodo: 'month', workspaces: [], usuarios: [], avisos: ['SP 4P: sem acesso à tabela system.ai_gateway.usage'],
    })
    renderPanel()

    expect(await screen.findByRole('status')).toHaveTextContent('Coleta Genie parcial: SP 4P')
    expect(screen.getByText(/sem acesso à tabela system\.ai_gateway\.usage/)).toBeInTheDocument()
  })

  it('distingue a origem do teto: individual vence o do workspace', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText(/teto do workspace/)).toBeInTheDocument()
    expect(screen.getByText(/limite individual/)).toBeInTheDocument()
  })

  it('oculta cards sem quota, mas mantém a contagem agregada de workspaces sem cota', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    const semCota = (await screen.findByText('Workspaces sem cota')).closest('.stat-card') as HTMLElement
    expect(within(semCota).getByText('1', { selector: '.stat-value' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace Sandbox' })).toBeNull()
    expect(document.querySelectorAll('.ck-semaphores button')).toHaveLength(3)
  })

  it('mostra os KPIs do mês', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('US$ 8.053,08')).toBeInTheDocument()  // consumo
    expect(screen.getByText('US$ 7.000')).toBeInTheDocument()            // cota
    expect(screen.getByText('Usuários acima do limite')).toBeInTheDocument()
  })

  it('explica o mês vazio em vez de mostrar tela em branco', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(
      cotas({ por_workspace: [], por_usuario: [] })
    )
    renderPanel()

    expect(await screen.findByText(/Sem consumo no mês atual/)).toBeInTheDocument()
    expect(screen.getByText(/Escolha outro período acima/)).toBeInTheDocument()
  })

  it('mostra falha da API separada de mês sem consumo e permite tentar novamente', async () => {
    vi.mocked(api.getDatabricksCotas)
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.queryByText(/Sem consumo no mês atual/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Cotas Workspace')).toBeInTheDocument()
    expect(screen.getByText('Cotas Usuário')).toBeInTheDocument()
  })

  it('fixa Cotas no mês corrente e deixa o período variável para a visão Consumo', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01']))
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace Sandbox' })).toBeNull()

    const hoje = new Date()
    const inicioMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`
    const hojeLocal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
    expect(vi.mocked(api.getDatabricksCotas).mock.calls[0][0]).toEqual({ data_inicio: inicioMes, data_fim: hojeLocal })
    expect(vi.mocked(api.getDatabricksCotaSerie).mock.calls[0][0]).toEqual({ data_inicio: inicioMes, data_fim: hojeLocal })
    expect(screen.queryByLabelText('Período')).not.toBeInTheDocument()
    expect(screen.getByText('Mês atual')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeDisabled()
  })

  it('filtra os dois painéis por workspace e reflete nos KPIs', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })

    // O workspace sem quota não entra no ranking, mas continua no total agregado.
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace Sandbox' })).toBeNull()
    expect(screen.getByText('US$ 8.053,08')).toBeInTheDocument()   // 6853,08 + 1200

    fireEvent.click(screen.getByLabelText('Workspace'))
    fireEvent.click(screen.getByText('Desenvolvimento'))

    // ws-sem sai dos cartoes e o consumo do KPI cai pro do ws-dev sozinho
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace Sandbox' })).toBeNull()
    expect(cartao('Workspace', 'Desenvolvimento')).toBeInTheDocument()
    expect(screen.getByText('US$ 6.853,08')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace Sandbox' })).toBeNull()
  })

  it('ao selecionar workspace, mostra usuários ativos mesmo sem quota configurada', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_usuario: [
        ...cotas().por_usuario,
        { workspace_id: 'ws-dev', usuario: 'ativo-sem-quota@example.com', custo: 0, dbus: 12, dbus_free: 12, dbus_pago: 0, limite: null, pct: null, origem_limite: null, budget_nome: null, status: 'sem_cota' },
      ],
    }))
    renderPanel()
    await screen.findByText('Cotas Workspace')
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Usuário ativo-sem-quota@example.com' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Workspace'))
    fireEvent.click(await screen.findByText('Desenvolvimento'))

    const usuarioAtivo = await screen.findByRole('button', { name: 'Ver detalhes de Usuário ativo-sem-quota@example.com' })
    expect(usuarioAtivo).toHaveTextContent('12 DBU')
    expect(usuarioAtivo).toHaveTextContent('Sem cota')
  })

  it('não oferece filtro de Produto — a tela lê do banco', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })

    expect(screen.queryByLabelText('Produto')).toBeNull()
    expect(screen.getByLabelText('Workspace')).toBeInTheDocument()
    expect(screen.getByLabelText('Usuário')).toBeInTheDocument()
  })

  it('ordena por DBU, corta no top 10 e deixa expandir quando custo Genie é zero', async () => {
    // Genie Free tem custo zero; o corte deve usar DBUs para destacar quem mais consome.
    const muitos: DatabricksCotaWorkspace[] = Array.from({ length: 30 }, (_, i) => ({
      workspace_id: 'ws-' + String(i).padStart(2, '0'),
      custo: 0, dbus: i + 1, dbus_free: i + 1, dbus_pago: 0,
      cota: 1000, pct: 0, budget_nome: 'Quota mensal', status: 'ok',
    }))
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({ por_workspace: muitos }))
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Ambiente 29' })

    // ws-29 e o maior consumo -> visivel; ws-00 e o menor -> fora do top 10
    expect(cartao('Workspace', 'Ambiente 29')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace Ambiente 00' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os 30' }))

    expect(cartao('Workspace', 'Ambiente 00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar só o top 10' })).toBeInTheDocument()
    // o 20o mais caro tambem estava fora do corte de 10
    expect(cartao('Workspace', 'Ambiente 09')).toBeInTheDocument()
  })

  it('informa quando nenhum workspace ou usuário do recorte tem quota', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_workspace: [{ workspace_id: 'sem-quota', custo: 0, dbus: 20, dbus_free: 20, dbus_pago: 0, cota: null, pct: null, budget_nome: null, status: 'sem_cota' }],
      por_usuario: [{ workspace_id: 'sem-quota', usuario: 'sem-quota@example.com', custo: 0, dbus: 20, dbus_free: 20, dbus_pago: 0, limite: null, pct: null, origem_limite: null, budget_nome: null, status: 'sem_cota' }],
    }))
    renderPanel()

    expect(await screen.findAllByText('Nenhuma quota configurada para os filtros atuais.')).toHaveLength(2)
    expect(document.querySelectorAll('.ck-semaphores button')).toHaveLength(0)
  })

  it('abre o detalhe ao clicar no cartão, com saldo e % disponível', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })

    fireEvent.click(cartao('Workspace', 'Desenvolvimento'))

    expect(await screen.findByRole('heading', { name: 'Workspace · Desenvolvimento' })).toBeInTheDocument()
    // saldo = cota - consumo = 7000 - 6853,08
    expect(screen.getByText('US$ 146,92')).toBeInTheDocument()
    // % disponível = 100 - 97,90
    expect(screen.getByText('2,1%')).toBeInTheDocument()
    // a lista de usuarios saiu daqui: quem mostra e o painel "Cotas Usuario"
    expect(screen.queryByText(/Usuários deste workspace/)).toBeNull()
  })

  it('preenche o detalhe privado com quota e consumo da query nativa Genie', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksGenieCotasInternas).mockResolvedValue({
      periodo: 'month',
      workspaces: [{
        workspace_id: 'ws-dev', workspace_nome: 'Desenvolvimento', custo: 25, custo_workspace: 25,
        dbus: 10, dbus_free: 10, dbus_pago: 0, cota: 100, pct: 25,
        budget_nome: 'Quota Genie Dev', budget_acao: 'Apenas Alerta', status: 'ok',
        dias: [{ dia: '2026-08-01', custo: 25, dbus: 10, dbus_free: 10 }],
      }],
      usuarios: [],
    })
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })
    fireEvent.click(cartao('Workspace', 'Desenvolvimento'))

    expect(await screen.findByText('Quota Genie Dev')).toBeInTheDocument()
    expect(screen.getByText('Apenas Alerta')).toBeInTheDocument()
    expect(screen.getByText('US$ 75')).toBeInTheDocument()
    expect(api.getDatabricksGenieCotasInternas).toHaveBeenCalledWith('month')
  })

  it('mostra 0% e usa a série diária nativa quando há DBU Free sem custo', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue({
      ...serie(['2026-08-01']),
      usuario: [{ dia: '2026-08-01', custo: 0, dbus: 99, dbus_free: 99 }],
    })
    vi.mocked(api.getDatabricksGenieCotasInternas).mockResolvedValue({
      periodo: 'month',
      workspaces: [{
        workspace_id: 'ws-dev', workspace_nome: 'Desenvolvimento', custo: 25, custo_workspace: 25,
        dbus: 10, dbus_free: 10, dbus_pago: 0, cota: 100, pct: 25,
        budget_nome: 'Quota Genie Dev', budget_acao: 'Bloqueia', status: 'atencao',
        dias: [{ dia: '2026-08-01', custo: 25, dbus: 10, dbus_free: 10 }],
      }],
      usuarios: [{
        workspace_id: 'ws-dev', usuario: 'ana@vivo.com.br', custo: 0, dbus: 200,
        dbus_free: 150, dbus_pago: 50, limite: 50, pct: null, origem_limite: 'workspace',
        budget_nome: 'Quota Genie Dev', budget_acao: 'Bloqueia', status: 'sem_cota',
        dias: [{ dia: '2026-08-01', custo: 0, dbus: 200, dbus_free: 150, dbus_pago: 50 }],
      }],
    })
    renderPanel()
    await screen.findByText('Cotas Workspace')
    const usuarioCard = await screen.findByRole('button', { name: 'Ver detalhes de Usuário ana@vivo.com.br' })

    fireEvent.click(usuarioCard)

    expect(usuarioCard).toHaveTextContent('0%')
    expect(usuarioCard).toHaveTextContent('Normal')
    expect(usuarioCard).toHaveTextContent(/US\$ 0 consumidos · 200 DBU · de US\$ 50 disponíveis/)
    expect(usuarioCard).toHaveTextContent('Free: 150 DBU · Pago: 50 DBU')
    const graficos = document.querySelectorAll('.ck-chart-wrap svg')
    const titulosWorkspace = [...graficos[0].querySelectorAll('title')].map((title) => title.textContent)
    expect(titulosWorkspace).toContain('2026-08-01 · Consumo do Workspace (USD): US$ 25')
    expect(titulosWorkspace).toContain('2026-08-01 · DBU Free: 10 DBU')
    expect(titulosWorkspace).not.toContain('2026-08-01 · DBU Free: 100 DBU')
    const titulosUsuario = [...graficos[1].querySelectorAll('title')].map((title) => title.textContent)
    expect(titulosUsuario).toContain('2026-08-01 · DBU Free: 150 DBU')
    expect(titulosUsuario).toContain('2026-08-01 · DBU Pago: 50 DBU')
    expect(screen.getAllByText('DBU Pago')).toHaveLength(2)
    expect(titulosUsuario.some((title) => title?.includes('99 DBU'))).toBe(false)
  })

  it('clicar num workspace seleciona ele no filtro e restringe "Cotas Usuário"', async () => {
    // o painel de usuario e um ranking GLOBAL por (workspace, usuario): sem
    // selecao ele mistura workspaces, e so parte dos usuarios de um workspace
    // aparece nele -- divergindo do modal, que lista todos os daquele. Clicar
    // no cartao passa a selecionar o workspace no filtro, como no cockpit.
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_usuario: [
        { workspace_id: 'ws-dev', usuario: 'pedro@vivo.com.br', custo: 1786.79, dbus: 50, dbus_free: 5, dbus_pago: 45, limite: 400, pct: 446.7, origem_limite: 'workspace', budget_nome: 'Teto', status: 'estourado' },
        { workspace_id: 'ws-sem', usuario: 'outro@vivo.com.br', custo: 900, dbus: 9, dbus_free: 0, dbus_pago: 9, limite: 100, pct: 90, origem_limite: 'individual', budget_nome: 'Teto Sandbox', status: 'critico' },
      ],
    }))
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01']))
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })

    // antes: os dois usuarios, de workspaces diferentes
    expect(cartao('Usuário', 'outro@vivo.com.br')).toBeInTheDocument()

    fireEvent.click(cartao('Workspace', 'Desenvolvimento'))

    // escopado ao painel: o modal aberto repete os mesmos rotulos de usuario
    const painelUsuarios = document.querySelectorAll('.ck-semaphores')[1] as HTMLElement
    // o usuario do outro workspace sai do painel...
    expect(within(painelUsuarios).queryByRole('button', { name: 'Ver detalhes de Usuário outro@vivo.com.br' })).toBeNull()
    expect(within(painelUsuarios).getByRole('button', { name: 'Ver detalhes de Usuário pedro@vivo.com.br' })).toBeInTheDocument()
    // ...o workspace vira um chip do filtro...
    expect(screen.getByRole('button', { name: 'Remover Desenvolvimento' })).toBeInTheDocument()
    // ...e o detalhe abre junto, como no cockpit
    expect(await screen.findByRole('heading', { name: 'Workspace · Desenvolvimento' })).toBeInTheDocument()
  })

  it('mostra a série agregada do workspace e pede seleção apenas para o gráfico de usuário', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01']))
    renderPanel()

    expect(await screen.findByText('Cota e consumo do Workspace')).toBeInTheDocument()
    expect(screen.getByText('Genie · Cota e uso do usuário')).toBeInTheDocument()
    expect(screen.getByText('Consumo do Workspace (USD)')).toBeInTheDocument()
    expect(screen.getByText(/Consumo Genie agregado de todos os workspaces/)).toBeInTheDocument()
    expect(screen.getByText(/Selecione um usuário no filtro/)).toBeInTheDocument()
    // toda a tela e restrita ao Genie: cartoes e series
    expect(vi.mocked(api.getDatabricksCotaSerie).mock.calls[0]?.[3]).toBe(true)
    expect(vi.mocked(api.getDatabricksCotas).mock.calls[0]?.[1]).toBe(true)
  })

  it('com 1 workspace, desenha consumo + cota e preenche os dias sem registro', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue({
      // 01 e 05/08: sem preencher virariam barras vizinhas e a leitura
      // "quanto por dia" ficaria errada
      workspace: [
        { dia: '2026-08-01', custo: 10, dbus: 1, dbus_free: 1 },
        { dia: '2026-08-05', custo: 90, dbus: 9, dbus_free: 9 },
      ],
      usuario: [], produto: [],
    })
    renderPanel()
    await screen.findByText('Cota e consumo do Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })

    fireEvent.click(cartao('Workspace', 'Desenvolvimento'))

    expect(await screen.findByText(/Desenvolvimento — cota configurada de US\$ 7\.000, dia a dia/)).toBeInTheDocument()
    expect(screen.getByText('Consumo do Workspace (USD)')).toBeInTheDocument()
    expect(screen.getByText('DBU Free')).toBeInTheDocument()
    expect(screen.getByText('Cota do Workspace (USD)')).toBeInTheDocument()
    // espera a serie chegar: a nota do titulo vem do estado e resolve antes dela
    expect(await screen.findByText(/maior dia: 05\/08\/2026/)).toBeInTheDocument()
    // 01..05 = 5 dias no eixo, nao 2
    const svg = document.querySelector('.ck-chart-wrap svg') as SVGElement
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toContain('03/08')
  })

  it('a legenda declara a cor do maior dia', async () => {
    // o pico sai em magenta; sem a entrada na legenda aparecia uma cor no
    // grafico que nao existia em lugar nenhum
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue({
      workspace: [
        { dia: '2026-08-01', custo: 10, dbus: 1, dbus_free: 1 },
        { dia: '2026-08-02', custo: 90, dbus: 9, dbus_free: 9 },
      ],
      usuario: [], produto: [],
    })
    renderPanel()
    await screen.findByText('Cota e consumo do Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Workspace Desenvolvimento' })
    fireEvent.click(cartao('Workspace', 'Desenvolvimento'))

    expect(await screen.findByText('Maior dia')).toBeInTheDocument()
  })

  it('o gráfico de usuário separa DBU de USD em escalas próprias', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01', '2026-08-02']))
    renderPanel()
    await screen.findByText('Genie · Cota e uso do usuário')

    fireEvent.click(cartao('Usuário', 'ana@vivo.com.br'))

    // as tres series do v56, com DBU Free na escala propria
    expect(await screen.findAllByText('DBU Free')).toHaveLength(2)
    expect(screen.getByText('Uso de usuário (USD)')).toBeInTheDocument()
    expect(screen.getByText('Cota do Usuário (USD)')).toBeInTheDocument()
    expect(vi.mocked(api.getDatabricksCotaSerie).mock.calls.some(([, workspaceId, usuario]) =>
      workspaceId === 'ws-dev' && usuario === 'ana@vivo.com.br')).toBe(true)
    expect(screen.getByRole('button', { name: 'Remover Desenvolvimento' })).toBeInTheDocument()
  })

  it('traz a quota Genie nativa (Budgets API) quando configurada para o usuário, distinta do orçamento local', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01', '2026-08-02']))
    // pedro@vivo.com.br não tem orçamento local (nenhum `limite`) neste cenário — só a quota nativa.
    vi.mocked(genieApi.getGenieQuotaUsuario).mockResolvedValue({ limite: 50, acao: 'BLOCK_USAGE', principal_encontrado: true, demo: false })
    renderPanel()
    await screen.findByText('Genie · Cota e uso do usuário')

    fireEvent.click(cartao('Usuário', 'pedro@vivo.com.br'))

    expect(await screen.findByText('Quota Genie nativa (USD)')).toBeInTheDocument()
    expect(genieApi.getGenieQuotaUsuario).toHaveBeenCalledWith('pedro@vivo.com.br', 'ws-dev')
    expect(await screen.findByText(/quota nativa de bloqueio de US\$ 50/)).toBeInTheDocument()
  })

  it('informa quando o snapshot do consumo Genie foi coletado', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01']))
    vi.mocked(api.getDatabricksGenieCotasInternas).mockResolvedValue({
      periodo: 'month', workspaces: [], usuarios: [],
      cache: { atualizado_em: '2026-11-18T12:00:00.000Z', desatualizado: true, atualizando: true },
    })
    renderPanel()

    expect(await screen.findByText(/Última coleta oficial:/)).toHaveTextContent('Atualizando dados')
  })

  it('sem quota nativa configurada, não desenha a série extra nem quebra o gráfico', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01', '2026-08-02']))
    vi.mocked(genieApi.getGenieQuotaUsuario).mockResolvedValue({ limite: null, acao: null, principal_encontrado: true, demo: false })
    renderPanel()
    await screen.findByText('Genie · Cota e uso do usuário')

    fireEvent.click(cartao('Usuário', 'pedro@vivo.com.br'))

    await screen.findAllByText('DBU Free')
    expect(screen.queryByText('Quota Genie nativa (USD)')).not.toBeInTheDocument()
  })

  it('mostra quota Genie nativa de workspace mesmo sem consumo local', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_workspace: [{ workspace_id: '123', custo: 0, dbus: 0, dbus_free: 0, dbus_pago: 0, cota: null, pct: null, budget_nome: null, status: 'sem_cota' }],
      por_usuario: [],
      resumo: { custo_total: 0, cota_total: 0, workspaces_sem_cota: 1, usuarios_acima_do_limite: 0 },
    }))
    vi.mocked(genieApi.listGenieBudgets).mockResolvedValue({
      budgets: [{
        budget_configuration_id: 'native-1', display_name: 'Quota nativa Sandbox',
        resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
        filter: { workspace_id: { values: [123] }, tags: [{ key: 'environment' }] },
        alert_configurations: [{
          quantity_threshold: '250', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
          action_configurations: [{ action_type: 'BLOCK_USAGE' }],
        }],
        _spend_status: { alert_spend_statuses: [{
          scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED', threshold: '250', percent_consumed: '50',
        }] },
      }],
      account_total: 1, genie_total: 1,
    })
    renderPanel()

    const totalNativas = (await screen.findByText('Workspaces com quota Genie nativa')).closest('.stat-card') as HTMLElement
    expect(within(totalNativas).getByText('1', { selector: '.stat-value' })).toBeInTheDocument()
    const workspaceCard = (await screen.findByText(/Genie nativo · Bloqueia · filtrada por tags/)).closest('button') as HTMLElement
    expect(workspaceCard).toHaveTextContent('50%')
    expect(workspaceCard).toHaveTextContent(/US\$ 125 consumidos · 0 DBU · de US\$ 250 disponíveis/)
    expect(workspaceCard).toHaveTextContent(/Genie nativo · Bloqueia · filtrada por tags/)
    expect(workspaceCard).toHaveTextContent('Normal')

    fireEvent.click(workspaceCard)
    const modal = document.querySelector('.ck-modal-box') as HTMLElement
    expect(await screen.findByRole('heading', { name: 'Workspace · Ambiente 123' })).toBeInTheDocument()
    expect(within(modal).getByText('Cota do workspace (USD)')).toBeInTheDocument()
    expect(within(modal).getByText('US$ 250')).toBeInTheDocument()
    expect(within(modal).getByText('Quota nativa Sandbox')).toBeInTheDocument()
  })

  it('preserva quota Genie nativa com limite zero como configuração válida', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_workspace: [{ workspace_id: '123', custo: 0, dbus: 0, dbus_free: 0, dbus_pago: 0, cota: null, pct: null, budget_nome: null, status: 'sem_cota' }],
      por_usuario: [],
      resumo: { custo_total: 0, cota_total: 0, workspaces_sem_cota: 1, usuarios_acima_do_limite: 0 },
    }))
    vi.mocked(genieApi.listGenieBudgets).mockResolvedValue({
      budgets: [{
        budget_configuration_id: 'native-zero', display_name: 'Quota nativa zero',
        resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
        filter: { workspace_id: { values: [123] } },
        alert_configurations: [{
          quantity_threshold: '0', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
          action_configurations: [{ action_type: 'BLOCK_USAGE' }],
        }],
        _spend_status: { alert_spend_statuses: [{
          scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED', percent_consumed: '100',
        }] },
      }],
      account_total: 1, genie_total: 1,
    })
    renderPanel()

    const totalNativas = (await screen.findByText('Workspaces com quota Genie nativa')).closest('.stat-card') as HTMLElement
    expect(within(totalNativas).getByText('1', { selector: '.stat-value' })).toBeInTheDocument()
    const workspaceCard = (await screen.findByText(/100% informado pelo Databricks; gasto não informado/)).closest('button') as HTMLElement
    expect(workspaceCard).toHaveTextContent('100%')
    expect(workspaceCard).toHaveTextContent(/US\$ 0 consumidos · 0 DBU · de US\$ 0 disponíveis/)
    expect(workspaceCard).toHaveTextContent(/100% informado pelo Databricks; gasto não informado/)
  })

  it('cota local e quota nativa configuradas ao mesmo tempo aparecem juntas', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01', '2026-08-02']))
    // ana@vivo.com.br já tem orçamento local (limite: 400, ver cotas()) — soma-se à quota nativa.
    vi.mocked(genieApi.getGenieQuotaUsuario).mockResolvedValue({ limite: 50, acao: 'EMAIL_NOTIFICATION', principal_encontrado: true, demo: false })
    renderPanel()
    await screen.findByText('Genie · Cota e uso do usuário')

    fireEvent.click(cartao('Usuário', 'ana@vivo.com.br'))

    expect(await screen.findByText('Cota do Usuário (USD)')).toBeInTheDocument()
    expect(await screen.findByText('Quota Genie nativa (USD)')).toBeInTheDocument()
    expect(await screen.findByText(/cota configurada de US\$ 400 · quota nativa de notificação de US\$ 50/)).toBeInTheDocument()
  })

  it('o detalhe do usuário mostra apenas o usuário selecionado e seu workspace', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_usuario: [
        ...cotas().por_usuario,
        { workspace_id: 'ws-sem', usuario: 'outro@example.com', custo: 10, dbus: 2, dbus_free: 0, dbus_pago: 2, limite: null, pct: null, origem_limite: null, budget_nome: null, status: 'sem_cota' },
      ],
    }))
    renderPanel()
    await screen.findByText('Cotas Workspace')
    await screen.findByRole('button', { name: 'Ver detalhes de Usuário pedro@vivo.com.br' })

    fireEvent.click(cartao('Usuário', 'pedro@vivo.com.br'))
    expect(await screen.findByRole('heading', { name: 'Workspace · Desenvolvimento' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Usuário · pedro@vivo.com.br' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Usuário · ana@vivo.com.br' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Usuário · outro@example.com' })).toBeNull()
  })

  it('no detalhe de quem estourou, % disponível e saldo ficam negativos em vez de zerados', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Usuário')

    fireEvent.click(cartao('Usuário', 'pedro@vivo.com.br'))

    expect(await screen.findByRole('heading', { name: 'Usuário · pedro@vivo.com.br' })).toBeInTheDocument()
    // 100 - 446,7 = -346,7 — mostra o quanto passou, nao trava em zero
    expect(screen.getByText('-346,7%')).toBeInTheDocument()
    // 400 - 1786,79 = -1386,79
    expect(screen.getByText('US$ -1.386,79')).toBeInTheDocument()
    // nossos orcamentos alertam, nunca bloqueiam
    const userSection = screen.getByRole('heading', { name: 'Usuário · pedro@vivo.com.br' }).closest('section') as HTMLElement
    expect(within(userSection).getByText('Alerta (não bloqueia)')).toBeInTheDocument()
  })
})

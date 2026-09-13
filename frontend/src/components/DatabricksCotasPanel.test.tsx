import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatabricksCotasPanel from './DatabricksCotasPanel'
import * as api from '../api/databricksColeta'
import type { DatabricksCotas, DatabricksCotaWorkspace } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><DatabricksCotasPanel /></QueryClientProvider>)
}

const cartao = (prefixo: string, nome: string) =>
  screen.getByRole('button', { name: `Ver detalhes de ${prefixo} ${nome}` })

describe('DatabricksCotasPanel', () => {
  beforeEach(() => vi.resetAllMocks())

  it('mostra o semáforo por workspace e por usuário com consumo, teto e percentual', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('Cotas Workspace')).toBeInTheDocument()
    expect(screen.getByText('Cotas Usuário')).toBeInTheDocument()

    // percentual no formato do cockpit: no maximo 2 casas, sem minimo --
    // 97,9% e nao 97,90%, e o teto sai como US$ 7.000 (sem ",00")
    expect(screen.getByText('97,9%')).toBeInTheDocument()
    expect(screen.getByText(/US\$ 6\.853,08 consumidos de US\$ 7\.000 disponíveis/)).toBeInTheDocument()

    // usuário estourado acima de 100% mostra o valor real, não saturado em 100
    expect(screen.getByText('446,7%')).toBeInTheDocument()
    // o cockpit nao tem um estado "estourado" proprio: acima de 100% segue
    // sendo Critico. O servidor continua distinguindo os dois (o alerta por
    // e-mail depende disso) -- so a apresentacao e que unifica.
    expect(screen.getAllByText('Crítico')).toHaveLength(2)
    expect(screen.getByText('Normal')).toBeInTheDocument()
  })

  it('distingue a origem do teto: individual vence o do workspace', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText(/teto do workspace/)).toBeInTheDocument()
    expect(screen.getByText(/limite individual/)).toBeInTheDocument()
  })

  it('marca quem não tem teto como "Sem cota" em vez de fingir 0%', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('Sem cota')).toBeInTheDocument()
    expect(screen.getByText(/limite não informado/)).toBeInTheDocument()
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

    // o padrao e "Todos os periodos", entao a mensagem nomeia esse recorte
    expect(await screen.findByText(/Sem consumo em todos os períodos/)).toBeInTheDocument()
    expect(screen.getByText(/Escolha outro período acima/)).toBeInTheDocument()
  })

  it('o Período oferece exatamente as opções do cockpit v56', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    const periodo = screen.getByLabelText('Período') as HTMLSelectElement
    expect([...periodo.options].map((o) => o.textContent)).toEqual([
      'Todos os períodos', 'Hoje', 'Mês atual', 'Últimos 7 dias',
      'Últimos 30 dias', 'Últimos 90 dias', 'Este ano', 'Personalizado',
    ])
    // padrao do cockpit: todos os periodos, ou seja, consulta sem recorte
    expect(vi.mocked(api.getDatabricksCotas).mock.calls[0][0]).toEqual({})
  })

  it('"Últimos 7 dias" vira um intervalo de 7 dias na consulta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20, 12))   // 20/08/2026, hora local
    try {
      vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
      renderPanel()
      await vi.waitFor(() => screen.getByText('Cotas Workspace'))

      fireEvent.change(screen.getByLabelText('Período'), { target: { value: '7' } })

      // 7 dias INCLUINDO hoje: 14..20, nunca 13..20
      expect(vi.mocked(api.getDatabricksCotas).mock.calls.some(
        (c) => c[0]?.data_inicio === '2026-08-14' && c[0]?.data_fim === '2026-08-20'
      )).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Personalizado" abre os dois campos de data e consulta o intervalo digitado', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    expect(screen.queryByLabelText('Data inicial')).toBeNull()
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } })

    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-06-30' } })

    expect(vi.mocked(api.getDatabricksCotas).mock.calls.some(
      (c) => c[0]?.data_inicio === '2026-06-01' && c[0]?.data_fim === '2026-06-30'
    )).toBe(true)
  })

  it('filtra os dois painéis por workspace e reflete nos KPIs', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    // sem filtro: os dois workspaces e os dois usuarios aparecem
    expect(cartao('Workspace', 'ws-sem')).toBeInTheDocument()
    expect(screen.getByText('US$ 8.053,08')).toBeInTheDocument()   // 6853,08 + 1200

    fireEvent.click(screen.getByLabelText('Workspace'))
    fireEvent.click(screen.getByText('ws-dev'))

    // ws-sem sai dos cartoes e o consumo do KPI cai pro do ws-dev sozinho
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace ws-sem' })).toBeNull()
    expect(cartao('Workspace', 'ws-dev')).toBeInTheDocument()
    expect(screen.getByText('US$ 6.853,08')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(cartao('Workspace', 'ws-sem')).toBeInTheDocument()
  })

  it('não oferece filtro de Produto — a tela lê do banco', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    expect(screen.queryByLabelText('Produto')).toBeNull()
    expect(screen.getByLabelText('Workspace')).toBeInTheDocument()
    expect(screen.getByLabelText('Usuário')).toBeInTheDocument()
  })

  it('ordena por maior consumo, corta no top 10 e deixa expandir', async () => {
    // 30 workspaces com consumo crescente: o corte tem que esconder os 20
    // MENORES, e o maior tem que aparecer primeiro.
    const muitos: DatabricksCotaWorkspace[] = Array.from({ length: 30 }, (_, i) => ({
      workspace_id: 'ws-' + String(i).padStart(2, '0'),
      custo: (i + 1) * 10, dbus: 1, dbus_free: 0, dbus_pago: 1,
      cota: null, pct: null, budget_nome: null, status: 'sem_cota',
    }))
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({ por_workspace: muitos }))
    renderPanel()
    await screen.findByText('Cotas Workspace')

    // ws-29 e o maior consumo -> visivel; ws-00 e o menor -> fora do top 10
    expect(cartao('Workspace', 'ws-29')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace ws-00' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os 30' }))

    expect(cartao('Workspace', 'ws-00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar só o top 10' })).toBeInTheDocument()
    // o 20o mais caro tambem estava fora do corte de 10
    expect(cartao('Workspace', 'ws-09')).toBeInTheDocument()
  })

  it('abre o detalhe ao clicar no cartão, com saldo e % disponível', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    fireEvent.click(cartao('Workspace', 'ws-dev'))

    expect(await screen.findByRole('heading', { name: 'Workspace · ws-dev' })).toBeInTheDocument()
    // saldo = cota - consumo = 7000 - 6853,08
    expect(screen.getByText('US$ 146,92')).toBeInTheDocument()
    // % disponível = 100 - 97,90
    expect(screen.getByText('2,1%')).toBeInTheDocument()
    // a lista de usuarios saiu daqui: quem mostra e o painel "Cotas Usuario"
    expect(screen.queryByText(/Usuários deste workspace/)).toBeNull()
  })

  it('clicar num workspace seleciona ele no filtro e restringe "Cotas Usuário"', async () => {
    // o painel de usuario e um ranking GLOBAL por (workspace, usuario): sem
    // selecao ele mistura workspaces, e so parte dos usuarios de um workspace
    // aparece nele -- divergindo do modal, que lista todos os daquele. Clicar
    // no cartao passa a selecionar o workspace no filtro, como no cockpit.
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({
      por_usuario: [
        { workspace_id: 'ws-dev', usuario: 'pedro@vivo.com.br', custo: 1786.79, dbus: 50, dbus_free: 5, dbus_pago: 45, limite: 400, pct: 446.7, origem_limite: 'workspace', budget_nome: 'Teto', status: 'estourado' },
        { workspace_id: 'ws-sem', usuario: 'outro@vivo.com.br', custo: 900, dbus: 9, dbus_free: 0, dbus_pago: 9, limite: null, pct: null, origem_limite: null, budget_nome: null, status: 'sem_cota' },
      ],
    }))
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01']))
    renderPanel()
    await screen.findByText('Cotas Workspace')

    // antes: os dois usuarios, de workspaces diferentes
    expect(cartao('Usuário', 'outro@vivo.com.br')).toBeInTheDocument()

    fireEvent.click(cartao('Workspace', 'ws-dev'))

    // escopado ao painel: o modal aberto repete os mesmos rotulos de usuario
    const painelUsuarios = document.querySelectorAll('.ck-semaphores')[1] as HTMLElement
    // o usuario do outro workspace sai do painel...
    expect(within(painelUsuarios).queryByRole('button', { name: 'Ver detalhes de Usuário outro@vivo.com.br' })).toBeNull()
    expect(within(painelUsuarios).getByRole('button', { name: 'Ver detalhes de Usuário pedro@vivo.com.br' })).toBeInTheDocument()
    // ...o workspace vira um chip do filtro...
    expect(screen.getByRole('button', { name: 'Remover ws-dev' })).toBeInTheDocument()
    // ...e o detalhe abre junto, como no cockpit
    expect(await screen.findByRole('heading', { name: 'Workspace · ws-dev' })).toBeInTheDocument()
  })

  it('mostra os dois painéis do cockpit v56 e pede uma seleção antes de desenhar', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('Cota e consumo do Workspace')).toBeInTheDocument()
    expect(screen.getByText('Genie · Cota e uso do usuário')).toBeInTheDocument()
    // cada um so faz sentido com UM item: somar varios workspaces numa serie
    // so nao diria nada e a cota viraria uma soma sem significado
    expect(screen.getByText(/Selecione um workspace no filtro/)).toBeInTheDocument()
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

    fireEvent.click(cartao('Workspace', 'ws-dev'))

    expect(await screen.findByText(/ws-dev — cota configurada de US\$ 7\.000, dia a dia/)).toBeInTheDocument()
    expect(screen.getByText('Consumo do Workspace (USD)')).toBeInTheDocument()
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
    fireEvent.click(cartao('Workspace', 'ws-dev'))

    expect(await screen.findByText('Maior dia')).toBeInTheDocument()
  })

  it('o gráfico de usuário separa DBU de USD em escalas próprias', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    vi.mocked(api.getDatabricksCotaSerie).mockResolvedValue(serie(['2026-08-01', '2026-08-02']))
    renderPanel()
    await screen.findByText('Genie · Cota e uso do usuário')

    fireEvent.click(cartao('Usuário', 'ana@vivo.com.br'))

    // as tres series do v56, com DBU Free na escala propria
    expect(await screen.findByText('DBU Free')).toBeInTheDocument()
    expect(screen.getByText('Uso de usuário (USD)')).toBeInTheDocument()
    expect(screen.getByText('Cota do Usuário (USD)')).toBeInTheDocument()
  })

  it('o detalhe do workspace não repete a lista de usuários', async () => {
    // ela divergia do painel "Cotas Usuário" (que e um Top 10 global) e agora
    // e ele quem mostra os usuarios do workspace selecionado
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    fireEvent.click(cartao('Workspace', 'ws-dev'))
    expect(await screen.findByRole('heading', { name: 'Workspace · ws-dev' })).toBeInTheDocument()
    expect(screen.queryByText(/Usuários deste workspace/)).toBeNull()
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
    expect(screen.getByText('Alerta (não bloqueia)')).toBeInTheDocument()
  })
})

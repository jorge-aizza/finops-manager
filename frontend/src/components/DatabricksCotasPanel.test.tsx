import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatabricksCotasPanel from './DatabricksCotasPanel'
import * as api from '../api/databricksColeta'
import type { DatabricksCotas, DatabricksCotaWorkspace } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

const cotas = (over: Partial<DatabricksCotas> = {}): DatabricksCotas => ({
  mes: '2026-08',
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

    expect(await screen.findByText(/Sem consumo no mês/)).toBeInTheDocument()
    expect(screen.getByText(/escolha outro mês/)).toBeInTheDocument()
  })

  it('troca o mês pelo seletor e refaz a consulta', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()
    await screen.findByText('Cotas Workspace')

    // fireEvent.change, nao userEvent.type: um <input type="month"> e composto
    // por segmentos (mes/ano) e o jsdom nao os simula -- digitar caractere a
    // caractere nao produz um value valido nem dispara o onChange.
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-07' } })

    expect(vi.mocked(api.getDatabricksCotas).mock.calls.some((c) => c[0] === '2026-07')).toBe(true)
  })

  it('ordena por maior consumo, corta no top 25 e deixa expandir', async () => {
    // 30 workspaces com consumo crescente: o corte tem que esconder os 5
    // MENORES, e o maior tem que aparecer primeiro.
    const muitos: DatabricksCotaWorkspace[] = Array.from({ length: 30 }, (_, i) => ({
      workspace_id: 'ws-' + String(i).padStart(2, '0'),
      custo: (i + 1) * 10, dbus: 1, dbus_free: 0, dbus_pago: 1,
      cota: null, pct: null, budget_nome: null, status: 'sem_cota',
    }))
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas({ por_workspace: muitos }))
    renderPanel()
    await screen.findByText('Cotas Workspace')

    // ws-29 e o maior consumo -> visivel; ws-00 e o menor -> fora do top 25
    expect(cartao('Workspace', 'ws-29')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver detalhes de Workspace ws-00' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os 30' }))

    expect(cartao('Workspace', 'ws-00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar só o top 25' })).toBeInTheDocument()
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
    // os usuários daquele workspace vêm junto
    expect(screen.getByText(/Usuários deste workspace/)).toBeInTheDocument()
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

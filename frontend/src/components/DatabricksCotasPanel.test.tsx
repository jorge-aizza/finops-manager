import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatabricksCotasPanel from './DatabricksCotasPanel'
import * as api from '../api/databricksColeta'
import type { DatabricksCotas } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

const cotas = (over: Partial<DatabricksCotas> = {}): DatabricksCotas => ({
  mes: '2026-08',
  por_workspace: [
    { workspace_id: 'ws-dev', custo: 6853.08, dbus: 100, cota: 7000, pct: 97.9, budget_nome: 'Quota Dev', status: 'critico' },
    { workspace_id: 'ws-sem', custo: 1200, dbus: 20, cota: null, pct: null, budget_nome: null, status: 'sem_cota' },
  ],
  por_usuario: [
    { workspace_id: 'ws-dev', usuario: 'pedro@vivo.com.br', custo: 1786.79, limite: 400, pct: 446.7, origem_limite: 'workspace', budget_nome: 'Teto por usuário', status: 'estourado' },
    { workspace_id: 'ws-dev', usuario: 'ana@vivo.com.br', custo: 120, limite: 400, pct: 30, origem_limite: 'individual', budget_nome: 'Exceção Ana', status: 'ok' },
  ],
  resumo: { custo_total: 8053.08, cota_total: 7000, workspaces_sem_cota: 1, usuarios_acima_do_limite: 1 },
  ...over,
})

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><DatabricksCotasPanel /></QueryClientProvider>)
}

describe('DatabricksCotasPanel', () => {
  beforeEach(() => vi.resetAllMocks())

  it('mostra o semáforo por workspace e por usuário com consumo, teto e percentual', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('Cotas por Workspace')).toBeInTheDocument()
    expect(screen.getByText('Cotas por Usuário')).toBeInTheDocument()

    // workspace com cota: percentual e o par consumo/teto
    expect(screen.getByText('98%')).toBeInTheDocument()
    expect(screen.getByText(/US\$ 6\.853,08 de US\$ 7\.000,00 disponíveis/)).toBeInTheDocument()
    expect(screen.getByText('Crítico')).toBeInTheDocument()

    // usuário estourado acima de 100% mostra o valor real, não saturado em 100
    expect(screen.getByText('447%')).toBeInTheDocument()
    expect(screen.getByText('Estourado')).toBeInTheDocument()
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
    expect(screen.getByText(/nenhum teto configurado/)).toBeInTheDocument()
  })

  it('mostra os KPIs do mês', async () => {
    vi.mocked(api.getDatabricksCotas).mockResolvedValue(cotas())
    renderPanel()

    expect(await screen.findByText('US$ 8.053,08')).toBeInTheDocument()  // consumo
    expect(screen.getByText('US$ 7.000,00')).toBeInTheDocument()         // cota
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
    await screen.findByText('Cotas por Workspace')

    // fireEvent.change, nao userEvent.type: um <input type="month"> e composto
    // por segmentos (mes/ano) e o jsdom nao os simula -- digitar caractere a
    // caractere nao produz um value valido nem dispara o onChange.
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-07' } })

    expect(vi.mocked(api.getDatabricksCotas).mock.calls.some((c) => c[0] === '2026-07')).toBe(true)
  })
})

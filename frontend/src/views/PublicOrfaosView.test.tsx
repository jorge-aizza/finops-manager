import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PublicOrfaosView from './PublicOrfaosView'
import * as orfaosApi from '../api/orfaosPublica'
import type { OrfaosPublicaResposta } from '../types/orfaosPublica'

vi.mock('../api/orfaosPublica')

const resposta: OrfaosPublicaResposta = {
  gerado_em: '2026-09-26T12:00:00Z',
  total_itens: 3,
  custo_mensal_estimado_total: 150,
  saving: null,
  por_categoria: [
    { categoria: 'disco_orfao', itens: 2, custo_mensal_estimado: 150 },
    { categoria: 'ip_solto', itens: 1, custo_mensal_estimado: 0 },
  ],
  itens: [
    { nome: 'disco-a', categoria: 'disco_orfao', subscription_name: 'Assinatura Produção', resource_group: 'RG-A', sku: 'Premium_LRS', tamanho_gb: 128, custo_mensal_estimado: 100, dias_orfao: 40 },
    { nome: 'disco-b', categoria: 'disco_orfao', subscription_name: 'Assinatura Homolog', resource_group: 'RG-B', sku: 'Standard_LRS', tamanho_gb: 64, custo_mensal_estimado: 50, dias_orfao: 5 },
    { nome: 'ip-x', categoria: 'ip_solto', subscription_name: 'Assinatura Produção', resource_group: 'RG-A', sku: 'Standard', tamanho_gb: null, custo_mensal_estimado: null, dias_orfao: null },
  ],
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicOrfaosView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(orfaosApi.getOrfaosPublica).mockResolvedValue(resposta)
})

describe('PublicOrfaosView', () => {
  it('lista os recursos, o custo total e mostra "—" (nunca R$ 0,00) sem billing', async () => {
    renderView()
    expect(await screen.findByText('disco-a')).toBeInTheDocument()
    expect(screen.getByText('ip-x')).toBeInTheDocument()
    expect(screen.getAllByText(/R\$\s150,00/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 recurso\(s\) sem billing conhecido/)).toBeInTheDocument()
  })

  it('filtra por Resource Group e por busca', async () => {
    const user = userEvent.setup()
    renderView()
    await screen.findByText('disco-a')

    await user.click(screen.getByText('Todos os Resource Groups'))
    const dropdown = within(document.querySelector('.cms-dropdown') as HTMLElement)
    await user.click(dropdown.getByText('RG-B'))
    await user.click(dropdown.getByRole('button', { name: 'OK ✓' }))
    expect(screen.queryByText('disco-a')).not.toBeInTheDocument()
    expect(screen.getByText('disco-b')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await user.type(screen.getByPlaceholderText('Buscar por recurso ou assinatura...'), 'ip-')
    expect(screen.getByText('ip-x')).toBeInTheDocument()
    expect(screen.queryByText('disco-a')).not.toBeInTheDocument()
  })

  it('permite selecionar múltiplos Resource Groups ao mesmo tempo', async () => {
    const user = userEvent.setup()
    renderView()
    await screen.findByText('disco-a')

    await user.click(screen.getByText('Todos os Resource Groups'))
    const dropdown = within(document.querySelector('.cms-dropdown') as HTMLElement)
    await user.click(dropdown.getByText('RG-A'))
    await user.click(dropdown.getByText('RG-B'))
    await user.click(dropdown.getByRole('button', { name: 'OK ✓' }))

    expect(screen.getByText('disco-a')).toBeInTheDocument()
    expect(screen.getByText('disco-b')).toBeInTheDocument()
    expect(screen.getByText('ip-x')).toBeInTheDocument()
    expect(screen.getByText('2 Resource Groups')).toBeInTheDocument()
  })

  it('exporta Excel com os itens filtrados e a descrição dos filtros', async () => {
    const user = userEvent.setup()
    vi.mocked(orfaosApi.baixarOrfaosPublicaExcel).mockResolvedValue(undefined)
    renderView()
    await screen.findByText('disco-a')

    await user.type(screen.getByPlaceholderText('Buscar por recurso ou assinatura...'), 'disco-')
    await user.click(screen.getByRole('button', { name: /Exportar Excel/ }))

    expect(orfaosApi.baixarOrfaosPublicaExcel).toHaveBeenCalledWith(
      [
        expect.objectContaining({ nome: 'disco-a' }),
        expect.objectContaining({ nome: 'disco-b' }),
      ],
      'Busca: "disco-"',
    )
  })

  it('abre a prévia de PDF com o botão Exportar PDF', async () => {
    const user = userEvent.setup()
    renderView()
    await screen.findByText('disco-a')

    await user.click(screen.getByRole('button', { name: /Exportar PDF/ }))
    expect(await screen.findByRole('button', { name: /Imprimir \/ Salvar PDF/ })).toBeInTheDocument()
    expect(screen.getByText('Prévia do Relatório')).toBeInTheDocument()
  })

  it('mostra a mensagem do servidor quando a consulta falha', async () => {
    vi.mocked(orfaosApi.getOrfaosPublica).mockRejectedValue(new Error('Visão de recursos órfãos desativada'))
    renderView()
    expect(await screen.findByText('Visão de recursos órfãos desativada')).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há recursos', async () => {
    vi.mocked(orfaosApi.getOrfaosPublica).mockResolvedValue({ ...resposta, total_itens: 0, itens: [], por_categoria: [], custo_mensal_estimado_total: 0 })
    renderView()
    expect(await screen.findByText('Nenhum recurso órfão para exibir.')).toBeInTheDocument()
  })

  it('mostra o nome da assinatura na tabela e permite buscar por ele', async () => {
    const user = userEvent.setup()
    renderView()
    await screen.findByText('disco-a')

    expect(screen.getByRole('columnheader', { name: 'Assinatura' })).toBeInTheDocument()
    expect(screen.getAllByText('Assinatura Produção').length).toBe(2) // disco-a e ip-x
    expect(screen.getByText('Assinatura Homolog')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/[Bb]uscar/), 'homolog')
    expect(screen.getByText('disco-b')).toBeInTheDocument()
    expect(screen.queryByText('disco-a')).not.toBeInTheDocument()
  })

  // Economia realizada no portal público (2026-10-17 — usuário pediu "nos dois portais").
  // Diferente dos outros cards, este NÃO reage aos filtros: é o total do processo, não do
  // recorte que o visitante está olhando. O filtro abaixo prova isso.
  it('mostra economia já realizada e não a altera ao filtrar a lista', async () => {
    const user = userEvent.setup()
    vi.mocked(orfaosApi.getOrfaosPublica).mockResolvedValue({
      ...resposta,
      saving: { economia_mensal: 1250, economia_acumulada: 7500, recursos_eliminados: 12 },
    })
    renderView()

    const card = (await screen.findByText('💰 Economia já realizada')).closest('.stat-card') as HTMLElement
    expect(within(card).getByText(/1\.250/)).toBeInTheDocument()
    expect(within(card).getByText(/12 recurso\(s\) eliminado\(s\)/)).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/[Bb]uscar/), 'homolog')
    expect(screen.queryByText('disco-a')).not.toBeInTheDocument()
    expect(within(card).getByText(/1\.250/)).toBeInTheDocument()
  })

  it('não mostra card de economia quando nada foi apurado', async () => {
    vi.mocked(orfaosApi.getOrfaosPublica).mockResolvedValue({
      ...resposta,
      saving: { economia_mensal: 0, economia_acumulada: 0, recursos_eliminados: 0 },
    })
    renderView()
    await screen.findByText('disco-a')
    expect(screen.queryByText('💰 Economia já realizada')).not.toBeInTheDocument()
  })
})

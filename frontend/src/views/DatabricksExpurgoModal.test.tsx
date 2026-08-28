import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksExpurgoModal from './DatabricksExpurgoModal'
import * as databricksColetaApi from '../api/databricksColeta'
import type { DatabricksResumo } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

function renderWithClient(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <DatabricksExpurgoModal onClose={onClose} />
    </QueryClientProvider>,
  ) }
}

const mockResumo: DatabricksResumo = {
  periodo: { inicio: '2015-01-01', fim: '2026-08-27' },
  tem_dados: true,
  total_custo: 602.85,
  por_mes: [{ mes: '2026-08', custo: 602.85 }],
  por_workspace: [
    { workspace_id: 'ws-prod-brsouth', custo: 247.42 },
    { workspace_id: 'ws-teste-verificacao', custo: 7.84 },
  ],
  por_sku: [],
  por_usuario: [],
  free_vs_pago: { free: 0, pago: 602.85 },
  dbus_free_vs_pago: { free: 0, pago: 60.285 },
  por_job: [], por_cluster: [], por_warehouse: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(mockResumo)
  window.showToast = vi.fn()
})

describe('DatabricksExpurgoModal', () => {
  it('carrega o resumo do banco com um range bem largo (não os últimos 6 meses padrão)', async () => {
    renderWithClient()
    await screen.findByText('R$ 602,85')
    expect(databricksColetaApi.getDatabricksResumo).toHaveBeenCalledWith('2015-01-01', expect.any(String))
  });

  it('modo período: verifica e habilita confirmar só depois do preview com total > 0', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.getDatabricksPurgePreview).mockResolvedValue({ total: 42 })
    renderWithClient()
    await screen.findByText('R$ 602,85')

    expect(screen.getByRole('button', { name: /Confirmar Expurgo/ })).toBeDisabled()

    await user.type(screen.getByLabelText('Data início'), '2026-08-01')
    await user.type(screen.getByLabelText('Data fim'), '2026-08-20')
    await user.click(screen.getByRole('button', { name: /Verificar quantos registros/ }))

    expect(await screen.findByText(/42 registros serão removidos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar Expurgo/ })).not.toBeDisabled()
  });

  it('modo workspace: lista os workspaces reais no select e verifica/confirma por workspace', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(databricksColetaApi.getDatabricksPurgePreview).mockResolvedValue({ total: 2 })
    vi.mocked(databricksColetaApi.executarDatabricksPurge).mockResolvedValue({ message: '2 registro(s) removidos.', removidos: 2 })
    renderWithClient()
    await screen.findByText('R$ 602,85')

    await user.click(screen.getByLabelText('Por workspace'))
    await user.selectOptions(screen.getByRole('combobox'), 'ws-teste-verificacao')
    await user.click(screen.getByRole('button', { name: '🔍 Verificar' }))

    await waitFor(() => expect(databricksColetaApi.getDatabricksPurgePreview).toHaveBeenCalledWith({ workspace_id: 'ws-teste-verificacao' }))
    await screen.findByText(/2 registros serão removidos/)

    await user.click(screen.getByRole('button', { name: /Confirmar Expurgo/ }))
    await waitFor(() => expect(databricksColetaApi.executarDatabricksPurge).toHaveBeenCalledWith({ workspace_id: 'ws-teste-verificacao' }))
    expect(await screen.findByText(/2 registro\(s\) removidos/)).toBeInTheDocument()
  });

  it('modo "tudo": confirmar fica habilitado sem precisar verificar antes', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('R$ 602,85')

    await user.click(screen.getByLabelText('Todos os dados'))
    expect(screen.getByRole('button', { name: /Confirmar Expurgo/ })).not.toBeDisabled()
  });
});

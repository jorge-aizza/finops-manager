import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksConfigModal from './DatabricksConfigModal'
import * as databricksColetaApi from '../api/databricksColeta'
import type { DatabricksConfig } from '../types/databricksColeta'

vi.mock('../api/databricksColeta')

const existingConfig: DatabricksConfig = {
  id: 3, nome: 'Databricks Principal', modo_auth: 'oauth_m2m', account_id: 'acc-123', client_id: 'client-123',
  workspace_host: 'https://adb-1234.5.azuredatabricks.net', warehouse_id: 'wh-1',
  ativo: true, is_padrao: false, granularidade_dias: 7, dia_execucao: 5, hora_execucao: null,
  dias_semana: null, auto_coleta: false, proxima_coleta: null, atualizado_em: '2026-01-01T00:00:00.000Z',
}

function renderWithClient(config: DatabricksConfig | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatabricksConfigModal config={config} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('DatabricksConfigModal', () => {
  it('exige Client Secret ao criar uma configuração nova, mas não ao editar uma existente', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksConfig).mockResolvedValue({ ok: true })
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome *'), 'Nova Config')
    await user.type(screen.getByLabelText('Account ID *'), 'acc-x')
    await user.type(screen.getByLabelText('Client ID *'), 'client-x')
    await user.type(screen.getByLabelText('Workspace Host *'), 'https://adb-x.azuredatabricks.net')
    await user.type(screen.getByLabelText('SQL Warehouse ID *'), 'wh-x')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Client Secret'), 'error')
    expect(databricksColetaApi.createDatabricksConfig).not.toHaveBeenCalled()
  })

  it('salva uma configuração nova com todos os campos preenchidos', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksConfig).mockResolvedValue({ ok: true })
    renderWithClient(null)

    await user.type(screen.getByLabelText('Nome *'), 'Nova Config')
    await user.type(screen.getByLabelText('Account ID *'), 'acc-x')
    await user.type(screen.getByLabelText('Client ID *'), 'client-x')
    await user.type(screen.getByLabelText(/Client Secret/), 'segredo-x')
    await user.type(screen.getByLabelText('Workspace Host *'), 'https://adb-x.azuredatabricks.net')
    await user.type(screen.getByLabelText('SQL Warehouse ID *'), 'wh-x')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksConfig).toHaveBeenCalledWith(expect.objectContaining({
      nome: 'Nova Config', account_id: 'acc-x', client_id: 'client-x',
      client_secret: 'segredo-x', workspace_host: 'https://adb-x.azuredatabricks.net', warehouse_id: 'wh-x',
    }))
  })

  it('edita uma configuração existente sem exigir novo Client Secret', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.updateDatabricksConfig).mockResolvedValue({ ok: true })
    renderWithClient(existingConfig)

    expect(screen.getByLabelText('Nome *')).toHaveValue('Databricks Principal')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.updateDatabricksConfig).toHaveBeenCalledWith(3, expect.objectContaining({
      nome: 'Databricks Principal', account_id: 'acc-123', client_id: 'client-123',
    }))
    const [, input] = vi.mocked(databricksColetaApi.updateDatabricksConfig).mock.calls[0]
    expect(input.client_secret).toBeUndefined()
  })

  it('modo PAT: exige Token ao criar, esconde Account/Client ID, e não exige Client Secret', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.createDatabricksConfig).mockResolvedValue({ ok: true })
    renderWithClient(null)

    await user.selectOptions(screen.getByLabelText('Modo de autenticação *'), 'pat')
    expect(screen.queryByLabelText('Account ID *')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Client ID *')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Nome *'), 'Config PAT')
    await user.type(screen.getByLabelText('Workspace Host *'), 'https://adb-x.azuredatabricks.net')
    await user.type(screen.getByLabelText('SQL Warehouse ID *'), 'wh-x')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Token'), 'error')
    expect(databricksColetaApi.createDatabricksConfig).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Personal Access Token/), 'dapi123')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.createDatabricksConfig).toHaveBeenCalledWith(expect.objectContaining({
      nome: 'Config PAT', modo_auth: 'pat', token: 'dapi123',
      workspace_host: 'https://adb-x.azuredatabricks.net', warehouse_id: 'wh-x',
    }))
    const [input] = vi.mocked(databricksColetaApi.createDatabricksConfig).mock.calls[0]
    expect(input.account_id).toBeUndefined()
    expect(input.client_secret).toBeUndefined()
  })

  it('modo PAT: edita uma configuração existente sem exigir novo token', async () => {
    const user = userEvent.setup()
    const patConfig: DatabricksConfig = { ...existingConfig, modo_auth: 'pat', account_id: '', client_id: '' }
    vi.mocked(databricksColetaApi.updateDatabricksConfig).mockResolvedValue({ ok: true })
    renderWithClient(patConfig)

    expect(screen.getByLabelText('Modo de autenticação *')).toHaveValue('pat')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(databricksColetaApi.updateDatabricksConfig).toHaveBeenCalledWith(3, expect.objectContaining({ modo_auth: 'pat' }))
    const [, input] = vi.mocked(databricksColetaApi.updateDatabricksConfig).mock.calls[0]
    expect(input.token).toBeUndefined()
  })
})

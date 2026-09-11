import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksImportManualPanel from './DatabricksImportManualPanel'
import * as databricksColetaApi from '../api/databricksColeta'

vi.mock('../api/databricksColeta')

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatabricksImportManualPanel />
    </QueryClientProvider>,
  )
}

function makeFile(name: string): File {
  return new File(['workspace_id,sku_name,usage_date\nws-1,DBU,2026-08-01'], name, { type: 'text/csv' })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('DatabricksImportManualPanel', () => {
  it('mostra o botão de seleção de arquivo no estado inicial', () => {
    renderWithClient()
    expect(screen.getByRole('button', { name: 'Selecionar Arquivo (.csv, .parquet, .zip)' })).toBeInTheDocument()
  });

  it('arquivo com extensão inválida é rejeitado com toast, sem chamar upload', async () => {
    renderWithClient()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [makeFile('planilha.xlsx')] })
    fireEvent.change(input)

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('.csv'), 'error'))
    expect(databricksColetaApi.uploadDatabricksImport).not.toHaveBeenCalled()
  });

  it('faz upload de um .csv válido e mostra toast de sucesso', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.uploadDatabricksImport).mockResolvedValue({ ok: true })
    renderWithClient()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('consumo.csv'))

    await waitFor(() => expect(databricksColetaApi.uploadDatabricksImport).toHaveBeenCalledWith(expect.any(File)))
    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Importação iniciada'), 'success'))
  });

  it('erro no upload (ex: coleta já em andamento) mostra toast de erro', async () => {
    const user = userEvent.setup()
    vi.mocked(databricksColetaApi.uploadDatabricksImport).mockRejectedValue(new Error('Uma coleta ou importação Databricks já está em andamento.'))
    renderWithClient()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('consumo.csv'))

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('já está em andamento'), 'error'))
  });
});

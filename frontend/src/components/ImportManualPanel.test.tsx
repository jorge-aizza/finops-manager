import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ImportManualPanel from './ImportManualPanel'
import * as coletaApi from '../api/coleta'
import type { ImportJob } from '../types/coleta'

vi.mock('../api/coleta')

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportManualPanel />
    </QueryClientProvider>,
  )
}

function makeFile(name: string): File {
  return new File(['col1,col2\n1,2'], name, { type: 'text/csv' })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('ImportManualPanel', () => {
  it('mostra o botão "Selecionar Arquivos" no estado inicial', () => {
    renderWithClient()
    expect(screen.getByRole('button', { name: 'Selecionar Arquivos' })).toBeInTheDocument()
  });

  it('arquivo com extensão inválida é rejeitado com toast, sem chamar upload', async () => {
    renderWithClient()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // fireEvent em vez de userEvent.upload — o atributo accept=".csv,.parquet,.zip"
    // já bloqueia essa seleção no picker real do SO; isso testa a validação
    // defensiva do próprio componente (ex: bypass via drag-and-drop).
    Object.defineProperty(input, 'files', { value: [makeFile('planilha.xlsx')] })
    fireEvent.change(input)

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('ignorado'), 'error'))
    expect(coletaApi.uploadImportFile).not.toHaveBeenCalled()
  });

  it('faz upload de um arquivo válido, aguarda o job concluir e mostra o resumo', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.uploadImportFile).mockResolvedValue({ kind: 'accepted', jobId: 'job-1', arquivo: 'agosto.csv' })
    const jobDone: ImportJob = {
      id: 'job-1', arquivo: 'agosto.csv', idx: 1, total: 1, status: 'done',
      linhas: 100, inseridos: 90, atualizados: 5, erros: 5, erros_det: [],
      subArquivo: null, erro: null, iniciado: Date.now(), concluido: Date.now(),
    }
    vi.mocked(coletaApi.getImportStatus).mockResolvedValue({ job: jobDone })

    renderWithClient()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('agosto.csv'))

    await waitFor(() => expect(coletaApi.uploadImportFile).toHaveBeenCalledWith(expect.any(File), 1, 1))
    expect(await screen.findByText('✅ Importação concluída')).toBeInTheDocument()
    expect(screen.getByText(/90/)).toBeInTheDocument()
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('90'), 'success')
  });

  it('job com status "error" no servidor aparece como falha no resumo', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.uploadImportFile).mockResolvedValue({ kind: 'accepted', jobId: 'job-2', arquivo: 'ruim.csv' })
    const jobErro: ImportJob = {
      id: 'job-2', arquivo: 'ruim.csv', idx: 1, total: 1, status: 'error',
      linhas: 0, inseridos: 0, atualizados: 0, erros: 0, erros_det: [],
      subArquivo: null, erro: 'Formato de arquivo inválido', iniciado: Date.now(), concluido: Date.now(),
    }
    vi.mocked(coletaApi.getImportStatus).mockResolvedValue({ job: jobErro })

    renderWithClient()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('ruim.csv'))

    expect(await screen.findByText(/0 ok · 1 com erro/)).toBeInTheDocument()
    expect(screen.getByText(/Formato de arquivo inválido/)).toBeInTheDocument()
  });

  it('"Importar mais arquivos" reseta o resultado pro estado inicial', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.uploadImportFile).mockResolvedValue({ kind: 'accepted', jobId: 'job-3', arquivo: 'a.csv' })
    vi.mocked(coletaApi.getImportStatus).mockResolvedValue({
      job: { id: 'job-3', arquivo: 'a.csv', idx: 1, total: 1, status: 'done', linhas: 10, inseridos: 10, atualizados: 0, erros: 0, erros_det: [], subArquivo: null, erro: null, iniciado: Date.now(), concluido: Date.now() },
    })

    renderWithClient()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('a.csv'))
    await screen.findByText('✅ Importação concluída')

    await user.click(screen.getByRole('button', { name: 'Importar mais arquivos' }))
    expect(screen.getByRole('button', { name: 'Selecionar Arquivos' })).toBeInTheDocument()
  });
});

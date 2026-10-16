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
    // Primeira chamada (resync no mount, ver useEffect) não acha job nenhum — é o caso
    // normal de "sessão nova, nada rodando ainda"; só a partir daqui o teste exercita o
    // fluxo real de upload, não o de retomada.
    vi.mocked(coletaApi.getImportStatus).mockResolvedValueOnce({ job: null }).mockResolvedValue({ job: jobDone })

    renderWithClient()
    await waitFor(() => expect(coletaApi.getImportStatus).toHaveBeenCalledTimes(1)) // resync do mount já rodou
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
    vi.mocked(coletaApi.getImportStatus).mockResolvedValueOnce({ job: null }).mockResolvedValue({ job: jobErro })

    renderWithClient()
    await waitFor(() => expect(coletaApi.getImportStatus).toHaveBeenCalledTimes(1))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('ruim.csv'))

    expect(await screen.findByText(/0 ok · 1 com erro/)).toBeInTheDocument()
    expect(screen.getByText(/Formato de arquivo inválido/)).toBeInTheDocument()
  });

  it('"Importar mais arquivos" reseta o resultado pro estado inicial', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.uploadImportFile).mockResolvedValue({ kind: 'accepted', jobId: 'job-3', arquivo: 'a.csv' })
    vi.mocked(coletaApi.getImportStatus).mockResolvedValueOnce({ job: null }).mockResolvedValue({
      job: { id: 'job-3', arquivo: 'a.csv', idx: 1, total: 1, status: 'done', linhas: 10, inseridos: 10, atualizados: 0, erros: 0, erros_det: [], subArquivo: null, erro: null, iniciado: Date.now(), concluido: Date.now() },
    })

    renderWithClient()
    await waitFor(() => expect(coletaApi.getImportStatus).toHaveBeenCalledTimes(1))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, makeFile('a.csv'))
    await screen.findByText('✅ Importação concluída')

    await user.click(screen.getByRole('button', { name: 'Importar mais arquivos' }))
    expect(screen.getByRole('button', { name: 'Selecionar Arquivos' })).toBeInTheDocument()
  });

  // Bug real corrigido (2026-10-16): trocar de tela e voltar perdia o acompanhamento de
  // um import em andamento, porque o componente nunca checava o servidor ao montar.
  describe('resync ao montar — import sobrevive a trocar de tela e voltar', () => {
    it('retoma o progresso de um import já em andamento no servidor', async () => {
      const jobRodando: ImportJob = {
        id: 'job-retomado', arquivo: 'setembro.csv', idx: 1, total: 1, status: 'running',
        linhas: 0, inseridos: 0, atualizados: 0, erros: 0, erros_det: [],
        subArquivo: null, erro: null, iniciado: Date.now(), concluido: null,
      }
      const jobConcluido: ImportJob = { ...jobRodando, status: 'done', linhas: 50, inseridos: 50, concluido: Date.now() }
      // 1ª chamada (mount): ainda rodando. 2ª em diante (polling de aguardarImport): concluído.
      vi.mocked(coletaApi.getImportStatus)
        .mockResolvedValueOnce({ job: jobRodando })
        .mockResolvedValue({ job: jobConcluido })

      renderWithClient()

      // O resync é assíncrono (consulta o servidor antes de decidir o estado) — espera
      // o progresso aparecer antes de checar que o botão "começar um import novo" sumiu,
      // já que há algo em curso.
      expect(await screen.findByText(/Importando/)).toBeInTheDocument()
      expect(screen.getByText(/setembro\.csv/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Selecionar Arquivos' })).not.toBeInTheDocument()

      expect(await screen.findByText('✅ Importação concluída')).toBeInTheDocument()
      expect(coletaApi.uploadImportFile).not.toHaveBeenCalled() // nunca foi um upload desta sessão
    });

    it('mostra o resultado de um import que terminou enquanto o usuário estava em outra tela', async () => {
      const jobTerminouLonge: ImportJob = {
        id: 'job-ausente', arquivo: 'outubro.csv', idx: 1, total: 1, status: 'done',
        linhas: 30, inseridos: 28, atualizados: 2, erros: 0, erros_det: [],
        subArquivo: null, erro: null, iniciado: Date.now() - 60_000, concluido: Date.now() - 1_000,
      }
      vi.mocked(coletaApi.getImportStatus).mockResolvedValue({ job: jobTerminouLonge })

      renderWithClient()

      expect(await screen.findByText('✅ Importação concluída')).toBeInTheDocument()
      expect(screen.getByText(/28/)).toBeInTheDocument()
      // Resync silencioso — não dispara toast de novo pra algo que já aconteceu sem o usuário ver.
      expect(window.showToast).not.toHaveBeenCalled()
    });

    it('sem nenhum job no servidor, mostra o estado inicial normalmente', async () => {
      vi.mocked(coletaApi.getImportStatus).mockResolvedValue({ job: null })
      renderWithClient()
      await waitFor(() => expect(coletaApi.getImportStatus).toHaveBeenCalled())
      expect(screen.getByRole('button', { name: 'Selecionar Arquivos' })).toBeInTheDocument()
    });
  });
});

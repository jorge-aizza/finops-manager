import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import MailingImportModal from './MailingImportModal'
import * as mailingApi from '../api/mailing'

vi.mock('../api/mailing')

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MailingImportModal onClose={onClose} />
      </QueryClientProvider>,
    ),
  }
}

function fakeFile(name: string, content = 'email\na@b.com') {
  return new File([content], name, { type: 'text/csv' })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('MailingImportModal', () => {
  it('rejeita extensão não suportada sem chamar a API', async () => {
    renderModal()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // fireEvent (não userEvent.upload) de propósito: userEvent respeita o atributo
    // `accept` do input e nem dispara o evento pra um arquivo que não bate com ele —
    // o que a gente quer testar aqui é a validação DENTRO do componente, que existe
    // justamente pro caso de alguém escolher "todos os arquivos" no seletor do SO.
    fireEvent.change(input, { target: { files: [fakeFile('lista.txt')] } })
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('.csv ou .xlsx'), 'error')
    expect(mailingApi.importarContatos).not.toHaveBeenCalled()
  });

  it('importa .csv e mostra o resultado do lote', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.importarContatos).mockResolvedValue({
      id: 1, arquivo_nome: 'lista.csv', total_linhas: 3, novos: 2, atualizados: 1, invalidos: 0,
      invalidos_detalhe: [], importado_por: 'admin', importado_em: '2026-10-16T00:00:00Z',
    })
    renderModal()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, fakeFile('lista.csv'))

    expect(await screen.findByText('✅ Importação concluída')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  });

  it('mostra os inválidos quando o lote tem linhas descartadas', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.importarContatos).mockResolvedValue({
      id: 2, arquivo_nome: 'lista.csv', total_linhas: 2, novos: 1, atualizados: 0, invalidos: 1,
      invalidos_detalhe: ['nao-e-email'], importado_por: 'admin', importado_em: '2026-10-16T00:00:00Z',
    })
    renderModal()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, fakeFile('lista.csv'))

    await screen.findByText('⚠️ Importação concluída, com avisos')
    await user.click(screen.getByRole('button', { name: 'Ver' }))
    expect(screen.getByText(/nao-e-email/)).toBeInTheDocument()
  });

  it('mostra erro do servidor sem travar o modal', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.importarContatos).mockRejectedValue(new Error('Não encontrei uma coluna de e-mail'))
    renderModal()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, fakeFile('lista.csv'))

    expect(await screen.findByRole('button', { name: 'Selecionar arquivo' })).toBeInTheDocument()
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('coluna de e-mail'), 'error')
  });
})

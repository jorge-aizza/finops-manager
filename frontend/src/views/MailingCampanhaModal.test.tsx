import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import MailingCampanhaModal from './MailingCampanhaModal'
import * as mailingApi from '../api/mailing'
import type { MailingCampanha } from '../types/mailing'

vi.mock('../api/mailing')
vi.mock('../components/MailingComposer', () => ({
  default: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea aria-label="corpo-html-mock" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const mockCampanha: MailingCampanha = {
  id: 5, assunto: 'Já existente', corpo_html: '<p>Conteúdo</p>', remetente_email: null, remetente_nome: null,
  status: 'rascunho', criado_por: 'admin', criado_em: '2026-10-10T00:00:00Z', atualizado_em: '2026-10-10T00:00:00Z',
  iniciado_em: null, concluido_em: null,
}

function renderModal(campanha: MailingCampanha | null, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MailingCampanhaModal campanha={campanha} onClose={onClose} />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
})

describe('MailingCampanhaModal', () => {
  it('bloqueia salvar sem assunto', async () => {
    const user = userEvent.setup()
    renderModal(null)
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Assunto'), 'error')
    expect(mailingApi.criarCampanha).not.toHaveBeenCalled()
  });

  it('cria uma campanha nova ao salvar', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.criarCampanha).mockResolvedValue({ ...mockCampanha, id: 99 })
    const { onClose } = renderModal(null)
    await user.type(screen.getByLabelText('Assunto *'), 'Novo comunicado')
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(mailingApi.criarCampanha).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  });

  it('atualiza uma campanha existente, não cria outra', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.atualizarCampanha).mockResolvedValue({ ok: true })
    renderModal(mockCampanha)
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))
    await waitFor(() => expect(mailingApi.atualizarCampanha).toHaveBeenCalledWith(5, expect.objectContaining({ assunto: 'Já existente' })))
    expect(mailingApi.criarCampanha).not.toHaveBeenCalled()
  });

  it('enviar teste sem assunto pede pra preencher antes', async () => {
    const user = userEvent.setup()
    renderModal(null)
    await user.type(screen.getByPlaceholderText('seu-email@vivo.com.br'), 'eu@vivo.com.br')
    await user.click(screen.getByRole('button', { name: /Enviar teste/ }))
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('assunto'), 'error')
    expect(mailingApi.enviarTesteCampanha).not.toHaveBeenCalled()
  });

  it('enviar teste numa campanha nova salva o rascunho primeiro, depois testa', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.criarCampanha).mockResolvedValue({ ...mockCampanha, id: 77 })
    vi.mocked(mailingApi.enviarTesteCampanha).mockResolvedValue({ ok: true, message: 'Teste enviado para eu@vivo.com.br' })
    renderModal(null)
    await user.type(screen.getByLabelText('Assunto *'), 'Comunicado de teste')
    await user.type(screen.getByPlaceholderText('seu-email@vivo.com.br'), 'eu@vivo.com.br')
    await user.click(screen.getByRole('button', { name: /Enviar teste/ }))

    await waitFor(() => expect(mailingApi.criarCampanha).toHaveBeenCalled())
    await waitFor(() => expect(mailingApi.enviarTesteCampanha).toHaveBeenCalledWith(77, 'eu@vivo.com.br'))
    expect(window.showToast).toHaveBeenCalledWith('Teste enviado para eu@vivo.com.br', 'success')
  });

  it('enviar teste numa campanha existente não cria uma nova, só atualiza', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.atualizarCampanha).mockResolvedValue({ ok: true })
    vi.mocked(mailingApi.enviarTesteCampanha).mockResolvedValue({ ok: true, message: 'Teste enviado' })
    renderModal(mockCampanha)
    await user.type(screen.getByPlaceholderText('seu-email@vivo.com.br'), 'eu@vivo.com.br')
    await user.click(screen.getByRole('button', { name: /Enviar teste/ }))

    await waitFor(() => expect(mailingApi.enviarTesteCampanha).toHaveBeenCalledWith(5, 'eu@vivo.com.br'))
    expect(mailingApi.criarCampanha).not.toHaveBeenCalled()
  });

  it('mostra erro quando o relay não está configurado', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.atualizarCampanha).mockResolvedValue({ ok: true })
    vi.mocked(mailingApi.enviarTesteCampanha).mockRejectedValue(new Error('Relay de Mailing não configurado. Configure em Integrações antes de testar.'))
    renderModal(mockCampanha)
    await user.type(screen.getByPlaceholderText('seu-email@vivo.com.br'), 'eu@vivo.com.br')
    await user.click(screen.getByRole('button', { name: /Enviar teste/ }))

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Relay de Mailing não configurado'), 'error'))
  });

  it('campanha nova já abre com o modelo padrão FinOps e remetente preenchido', async () => {
    renderModal(null)
    const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
    expect(editor.value).toContain('finops-banner-comunicado.png')
    expect(editor.value).toContain('Como funcionará o processo?')
    expect(screen.getByLabelText('Nome do remetente')).toHaveValue('FinOps Vivo')
    expect(screen.getByLabelText('E-mail do remetente')).toHaveValue('finops.vivo.br@telefonica.com')
  });

  it('editar uma campanha existente usa o conteúdo salvo, não o modelo padrão', async () => {
    renderModal(mockCampanha)
    const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
    expect(editor.value).toBe('<p>Conteúdo</p>')
    expect(editor.value).not.toContain('finops-banner-comunicado.png')
  });

  it('"Começar em branco" limpa o modelo padrão após confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderModal(null)
    const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
    expect(editor.value).toContain('finops-banner-comunicado.png')

    await user.click(screen.getByRole('button', { name: /Começar em branco/ }))
    expect(editor.value).not.toContain('finops-banner-comunicado.png')
  });

  it('"Começar em branco" não existe ao editar uma campanha já existente', async () => {
    renderModal(mockCampanha)
    expect(screen.queryByRole('button', { name: /Começar em branco/ })).not.toBeInTheDocument()
  });

  it('alterna entre editor e prévia', async () => {
    const user = userEvent.setup()
    renderModal(mockCampanha)
    expect(screen.getByLabelText('corpo-html-mock')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Prévia/ }))
    expect(screen.queryByLabelText('corpo-html-mock')).not.toBeInTheDocument()
    expect(screen.getByText('Conteúdo')).toBeInTheDocument()
  });
})

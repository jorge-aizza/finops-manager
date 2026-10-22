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
  vi.mocked(mailingApi.listTemplates).mockResolvedValue([])
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

  it('campanha nova começa em branco, com o remetente padrão já preenchido', async () => {
    renderModal(null)
    const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
    expect(editor.value).toBe('<p></p>')
    expect(screen.getByLabelText('Nome do remetente')).toHaveValue('FinOps Vivo')
    expect(screen.getByLabelText('E-mail do remetente')).toHaveValue('finops.vivo.br@telefonica.com')
  });

  it('editar uma campanha existente usa o conteúdo salvo', async () => {
    renderModal(mockCampanha)
    const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
    expect(editor.value).toBe('<p>Conteúdo</p>')
  });

  it('"Criar novo (em branco)" limpa o conteúdo após confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderModal(mockCampanha) // já vem com conteúdo salvo, pra ter o que limpar
    const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
    expect(editor.value).toBe('<p>Conteúdo</p>')

    await user.click(screen.getByRole('button', { name: /Criar novo \(em branco\)/ }))
    expect(editor.value).toBe('<p></p>')
  });

  describe('seletor de modelos', () => {
    it('mostra o modelo embutido FinOps e carrega seu conteúdo ao escolher', async () => {
      const user = userEvent.setup()
      renderModal(null)
      await user.click(screen.getByRole('button', { name: /Usar modelo/ }))

      expect(screen.getByText('Modelo FinOps — Governança de Recursos Órfãos')).toBeInTheDocument()
      await user.click(screen.getByText('Modelo FinOps — Governança de Recursos Órfãos'))

      const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
      // Banner em .jpg desde que as imagens passaram a viajar embutidas no e-mail: o
      // .png de 1 MB iria dentro de CADA mensagem. O .png segue no repositório porque
      // campanhas antigas salvas no banco ainda apontam para ele.
      expect(editor.value).toContain('finops-banner-comunicado.jpg')
      expect(editor.value).toContain('Como funcionará o processo?')
    });

    it('pede confirmação antes de substituir conteúdo já existente', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderModal(mockCampanha) // já tem '<p>Conteúdo</p>'
      await user.click(screen.getByRole('button', { name: /Usar modelo/ }))
      await user.click(screen.getByText('Modelo FinOps — Governança de Recursos Órfãos'))

      expect(confirmSpy).toHaveBeenCalled()
      const editor = screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement
      expect(editor.value).toBe('<p>Conteúdo</p>') // recusou — manteve o original
    });

    it('lista modelos salvos pelo usuário, além do embutido', async () => {
      const user = userEvent.setup()
      vi.mocked(mailingApi.listTemplates).mockResolvedValue([
        { id: 1, nome: 'Aviso de Manutenção', corpo_html: '<p>Manutenção programada</p>', remetente_nome: null, remetente_email: null, criado_por: 'admin', criado_em: '', atualizado_em: '' },
      ])
      renderModal(null)
      await user.click(screen.getByRole('button', { name: /Usar modelo/ }))

      expect(await screen.findByText('Aviso de Manutenção')).toBeInTheDocument()
      await user.click(screen.getByText('Aviso de Manutenção'))
      expect((screen.getByLabelText('corpo-html-mock') as HTMLTextAreaElement).value).toBe('<p>Manutenção programada</p>')
    });

    it('exclui um modelo salvo, não o embutido (que não tem botão de excluir)', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.mocked(mailingApi.listTemplates).mockResolvedValue([
        { id: 1, nome: 'Aviso de Manutenção', corpo_html: '<p>x</p>', remetente_nome: null, remetente_email: null, criado_por: 'admin', criado_em: '', atualizado_em: '' },
      ])
      vi.mocked(mailingApi.excluirTemplate).mockResolvedValue({ ok: true })
      renderModal(null)
      await user.click(screen.getByRole('button', { name: /Usar modelo/ }))
      await screen.findByText('Aviso de Manutenção')

      expect(screen.getAllByTitle('Excluir modelo')).toHaveLength(1) // só o modelo custom, não o embutido
      await user.click(screen.getByTitle('Excluir modelo'))
      await waitFor(() => expect(mailingApi.excluirTemplate).toHaveBeenCalledWith(1))
    });
  });

  describe('salvar como modelo', () => {
    it('salva o conteúdo atual como um novo modelo nomeado', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'prompt').mockReturnValue('Meu Novo Modelo')
      vi.mocked(mailingApi.salvarTemplate).mockResolvedValue({
        id: 9, nome: 'Meu Novo Modelo', corpo_html: '<p>Conteúdo</p>', remetente_nome: null, remetente_email: null, criado_por: 'admin', criado_em: '', atualizado_em: '',
      })
      renderModal(mockCampanha)
      await user.click(screen.getByRole('button', { name: /Salvar como modelo/ }))

      await waitFor(() => expect(mailingApi.salvarTemplate).toHaveBeenCalledWith(expect.objectContaining({
        nome: 'Meu Novo Modelo', corpo_html: '<p>Conteúdo</p>',
      })))
      expect(window.showToast).toHaveBeenCalledWith('Modelo salvo.', 'success')
    });

    it('não salva nada se o usuário cancelar o prompt de nome', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'prompt').mockReturnValue(null)
      renderModal(mockCampanha)
      await user.click(screen.getByRole('button', { name: /Salvar como modelo/ }))
      expect(mailingApi.salvarTemplate).not.toHaveBeenCalled()
    });
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

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import MailingView from './MailingView'
import * as mailingApi from '../api/mailing'
import type { MailingCampanha, MailingContato, MailingEnvio } from '../types/mailing'

vi.mock('../api/mailing')
// MailingComposer embute TipTap/ProseMirror — já coberto por smoke test próprio;
// aqui o que importa é a integração (abre modal, salva, dispara), não o editor em si.
vi.mock('../components/MailingComposer', () => ({
  default: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea aria-label="corpo-html-mock" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const mockContatos: MailingContato[] = [
  { id: 1, email: 'ana@exemplo.com', nome: 'Ana', status: 'ativo', origem: 'manual', criado_em: '2026-10-01T00:00:00Z', atualizado_em: '2026-10-01T00:00:00Z' },
  { id: 2, email: 'bruno@exemplo.com', nome: 'Bruno', status: 'opt_out', origem: 'import', criado_em: '2026-10-01T00:00:00Z', atualizado_em: '2026-10-01T00:00:00Z' },
]

const mockCampanhas: MailingCampanha[] = [
  {
    id: 10, assunto: 'Comunicado de Outubro', corpo_html: '<p>Oi</p>', remetente_email: null, remetente_nome: null,
    status: 'rascunho', criado_por: 'admin', criado_em: '2026-10-10T00:00:00Z', atualizado_em: '2026-10-10T00:00:00Z',
    iniciado_em: null, concluido_em: null, total_destinatarios: 0, total_enviados: 0, total_falhas: 0,
  },
  {
    id: 11, assunto: 'Comunicado Concluído', corpo_html: '<p>Oi 2</p>', remetente_email: null, remetente_nome: null,
    status: 'concluida', criado_por: 'admin', criado_em: '2026-10-09T00:00:00Z', atualizado_em: '2026-10-09T00:00:00Z',
    iniciado_em: '2026-10-09T00:01:00Z', concluido_em: '2026-10-09T00:05:00Z', total_destinatarios: 2, total_enviados: 1, total_falhas: 1,
  },
]

const mockEnvios: MailingEnvio[] = [
  { id: 1, campanha_id: 11, contato_id: 1, email: 'ana@exemplo.com', nome: 'Ana', status: 'enviado', enviado_em: '2026-10-09T00:02:00Z', erro: null },
  { id: 2, campanha_id: 11, contato_id: 2, email: 'bruno@exemplo.com', nome: 'Bruno', status: 'falha', enviado_em: null, erro: 'Connection timeout' },
]

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MailingView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mailingApi.listContatos).mockResolvedValue(mockContatos)
  vi.mocked(mailingApi.listImportLotes).mockResolvedValue([])
  vi.mocked(mailingApi.listCampanhas).mockResolvedValue(mockCampanhas)
  vi.mocked(mailingApi.listEnviosCampanha).mockResolvedValue(mockEnvios)
  vi.mocked(mailingApi.getProgressoCampanha).mockResolvedValue({ em_execucao: false, progresso: null })
  window.showToast = vi.fn()
})

describe('MailingView — Destinatários', () => {
  it('lista os contatos com status', async () => {
    renderWithClient()
    const linhaAna = (await screen.findByText('ana@exemplo.com')).closest('tr')!
    const linhaBruno = screen.getByText('bruno@exemplo.com').closest('tr')!
    expect(within(linhaAna).getByText('Ativo')).toBeInTheDocument()
    expect(within(linhaBruno).getByText('Descadastrado')).toBeInTheDocument()
  });

  it('adiciona um contato manualmente', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.criarContato).mockResolvedValue({ ok: true })
    renderWithClient()
    await screen.findByText('ana@exemplo.com')

    await user.type(screen.getByLabelText('E-mail'), 'novo@exemplo.com')
    await user.click(screen.getByRole('button', { name: '+ Adicionar' }))

    await waitFor(() => expect(mailingApi.criarContato).toHaveBeenCalledWith({ email: 'novo@exemplo.com', nome: undefined }))
  });

  it('descadastra e reativa um contato pelo botão de ação', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.atualizarContato).mockResolvedValue({ ok: true })
    renderWithClient()
    const linhaAna = (await screen.findByText('ana@exemplo.com')).closest('tr')!
    await user.click(within(linhaAna).getByTitle('Descadastrar'))
    await waitFor(() => expect(mailingApi.atualizarContato).toHaveBeenCalledWith(1, { status: 'opt_out' }))

    const linhaBruno = screen.getByText('bruno@exemplo.com').closest('tr')!
    await user.click(within(linhaBruno).getByTitle('Reativar'))
    await waitFor(() => expect(mailingApi.atualizarContato).toHaveBeenCalledWith(2, { status: 'ativo' }))
  });

  it('exclui um contato após confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(mailingApi.excluirContato).mockResolvedValue({ ok: true })
    renderWithClient()
    const linha = (await screen.findByText('ana@exemplo.com')).closest('tr')!
    await user.click(within(linha).getByTitle('Excluir'))
    await waitFor(() => expect(mailingApi.excluirContato).toHaveBeenCalledWith(1))
  });

  it('abre o modal de importação', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('ana@exemplo.com')
    await user.click(screen.getByRole('button', { name: /Importar lista/ }))
    expect(screen.getByText('Importar lista de destinatários')).toBeInTheDocument()
  });
})

describe('MailingView — Comunicados', () => {
  async function abrirAbaComunicados(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Comunicados' }))
    await screen.findByText('Comunicado de Outubro')
  }

  it('lista campanhas com status e totais', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)
    expect(screen.getByText('Comunicado Concluído')).toBeInTheDocument()
    expect(screen.getByText('Rascunho')).toBeInTheDocument()
    expect(screen.getByText('✅ Concluída')).toBeInTheDocument()
  });

  it('rascunho mostra ações de editar/enviar/excluir; concluída não mostra nenhuma', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)

    const linhaRascunho = screen.getByText('Comunicado de Outubro').closest('tr')!
    expect(within(linhaRascunho).getByTitle('Enviar')).toBeInTheDocument()
    expect(within(linhaRascunho).getByTitle('Editar')).toBeInTheDocument()

    const linhaConcluida = screen.getByText('Comunicado Concluído').closest('tr')!
    expect(within(linhaConcluida).queryByTitle('Enviar')).not.toBeInTheDocument()
  });

  it('pede confirmação antes de enviar e dispara a API', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(mailingApi.enviarCampanha).mockResolvedValue({ ok: true, message: 'Envio iniciado para 5 destinatário(s)' })
    renderWithClient()
    await abrirAbaComunicados(user)

    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    await user.click(within(linha).getByTitle('Enviar'))

    await waitFor(() => expect(mailingApi.enviarCampanha).toHaveBeenCalledWith(10))
    expect(window.showToast).toHaveBeenCalledWith('Envio iniciado para 5 destinatário(s)', 'success')
  });

  it('não envia se o usuário cancelar a confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithClient()
    await abrirAbaComunicados(user)
    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    await user.click(within(linha).getByTitle('Enviar'))
    expect(mailingApi.enviarCampanha).not.toHaveBeenCalled()
  });

  it('abre o composer ao clicar em Novo Comunicado', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)
    await user.click(screen.getByRole('button', { name: '+ Novo Comunicado' }))
    expect(screen.getByText('Novo Comunicado')).toBeInTheDocument()
    expect(screen.getByLabelText('corpo-html-mock')).toBeInTheDocument()
  });

  it('expande o painel de acompanhamento ao clicar na linha, mostrando enviados e falhas', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)

    await user.click(screen.getByText('Comunicado Concluído'))

    expect(await screen.findByText('Acompanhamento — Comunicado Concluído')).toBeInTheDocument()
    expect(screen.getByText('Connection timeout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reenviar 1 falha/ })).toBeInTheDocument()
  });

  it('reenvia falhas a partir do painel de acompanhamento', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.reenviarFalhasCampanha).mockResolvedValue({ ok: true, message: 'Reprocessando 1 envio(s) com falha' })
    renderWithClient()
    await abrirAbaComunicados(user)
    await user.click(screen.getByText('Comunicado Concluído'))
    await screen.findByText('Acompanhamento — Comunicado Concluído')

    await user.click(screen.getByRole('button', { name: /Reenviar 1 falha/ }))
    await waitFor(() => expect(mailingApi.reenviarFalhasCampanha).toHaveBeenCalledWith(11))
  });

  it('rascunho não mostra botão de reenviar falhas (nunca foi enviado)', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)
    await user.click(screen.getByText('Comunicado de Outubro'))
    await screen.findByText('Acompanhamento — Comunicado de Outubro')
    expect(screen.queryByText(/Reenviar/)).not.toBeInTheDocument()
  });
})

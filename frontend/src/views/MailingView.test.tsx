import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import MailingView from './MailingView'
import * as mailingApi from '../api/mailing'
import type { MailingCampanha, MailingContato, MailingEnvio, MailingGrupo } from '../types/mailing'

vi.mock('../api/mailing')
// MailingComposer embute TipTap/ProseMirror — já coberto por smoke test próprio;
// aqui o que importa é a integração (abre modal, salva, dispara), não o editor em si.
vi.mock('../components/MailingComposer', () => ({
  default: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea aria-label="corpo-html-mock" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const mockContatos: MailingContato[] = [
  { id: 1, email: 'ana@exemplo.com', nome: 'Ana', status: 'ativo', origem: 'manual', grupos: ['Diretoria', 'FinOps'], criado_em: '2026-10-01T00:00:00Z', atualizado_em: '2026-10-01T00:00:00Z' },
  { id: 2, email: 'bruno@exemplo.com', nome: 'Bruno', status: 'opt_out', origem: 'import', grupos: [], criado_em: '2026-10-01T00:00:00Z', atualizado_em: '2026-10-01T00:00:00Z' },
]
const mockGrupo: MailingGrupo = {
  id: 5, nome: 'Diretoria', descricao: null, total_contatos: 2, contato_ids: [1, 2],
  criado_em: '2026-10-01T00:00:00Z', atualizado_em: '2026-10-01T00:00:00Z',
}

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
  vi.mocked(mailingApi.listGrupos).mockResolvedValue([])
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

  it('mostra todos os grupos de cada contato e um traço quando não pertence a nenhum', async () => {
    renderWithClient()
    const linhaAna = (await screen.findByText('ana@exemplo.com')).closest('tr')!
    const linhaBruno = screen.getByText('bruno@exemplo.com').closest('tr')!

    expect(within(linhaAna).getByText('Diretoria, FinOps')).toBeInTheDocument()
    expect(within(linhaBruno).getByText('—')).toBeInTheDocument()
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

  it('cria um grupo associando contatos existentes', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.criarGrupo).mockResolvedValue({ ok: true, id: 5 })
    renderWithClient()
    await screen.findByText('ana@exemplo.com')

    await user.click(screen.getByRole('button', { name: '+ Novo grupo' }))
    await user.type(screen.getByLabelText('Nome *'), 'Diretoria')
    await user.click(screen.getByRole('checkbox', { name: /Ana/ }))
    await user.click(screen.getByRole('button', { name: 'Salvar grupo' }))

    await waitFor(() => expect(mailingApi.criarGrupo).toHaveBeenCalledWith({ nome: 'Diretoria', descricao: null, contato_ids: [1] }))
  });

  it('disponibiliza o modelo Excel no painel de grupos', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.baixarModeloImportacaoMailing).mockResolvedValue()
    renderWithClient()

    await user.click(screen.getByRole('button', { name: 'Baixar modelo Excel' }))

    expect(mailingApi.baixarModeloImportacaoMailing).toHaveBeenCalledOnce()
  });

  it('importa CSV para um grupo e mostra o resumo', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.listGrupos).mockResolvedValue([mockGrupo])
    vi.mocked(mailingApi.importarContatosGrupo).mockResolvedValue({
      ok: true, grupo_id: 5, arquivo_nome: 'diretoria.csv', total_linhas: 2,
      novos: 1, atualizados: 1, associados: 2, invalidos: 0, invalidos_detalhe: [],
    })
    renderWithClient()
    await screen.findByText('Diretoria')

    await user.click(screen.getByTitle('Importar CSV/Excel para o grupo'))
    const arquivo = new File(['Email,Nome\nnovo@exemplo.com,Novo'], 'diretoria.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Arquivo CSV ou Excel do grupo'), arquivo)

    await waitFor(() => expect(mailingApi.importarContatosGrupo).toHaveBeenCalledWith(5, arquivo))
    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith(
      'Importação concluída: 2 contato(s) no grupo; 1 novo(s), 1 atualizado(s), 0 inválido(s).', 'success',
    ))
  });
})

describe('MailingView — Comunicados', () => {
  async function abrirAbaComunicados(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: 'Comunicados' }))
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

  it('rascunho mostra ações de editar/enviar/excluir e concluída oferece editar, reenviar e excluir', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)

    const linhaRascunho = screen.getByText('Comunicado de Outubro').closest('tr')!
    expect(within(linhaRascunho).getByTitle('Enviar')).toBeInTheDocument()
    expect(within(linhaRascunho).getByTitle('Editar')).toBeInTheDocument()

    const linhaConcluida = screen.getByText('Comunicado Concluído').closest('tr')!
    expect(within(linhaConcluida).queryByTitle('Enviar')).not.toBeInTheDocument()
    expect(within(linhaConcluida).queryByTitle('Editar')).not.toBeInTheDocument()
    expect(within(linhaConcluida).getByTitle('Editar e reenviar')).toBeInTheDocument()
    expect(within(linhaConcluida).getByTitle('Reenviar')).toBeInTheDocument()
    expect(within(linhaConcluida).getByTitle('Excluir comunicado')).toBeInTheDocument()
    await user.click(within(linhaConcluida).getByRole('button', { name: 'Ver acompanhamento' }))
    expect(within(linhaConcluida).getByRole('button', { name: 'Ocultar acompanhamento' })).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Acompanhamento — Comunicado Concluído')).toBeInTheDocument()
  });

  it('abre edição como cópia e salva um novo rascunho sem alterar o comunicado concluído', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.criarCampanha).mockResolvedValue({ ...mockCampanhas[1], id: 99, status: 'rascunho' })
    renderWithClient()
    await abrirAbaComunicados(user)

    const linha = screen.getByText('Comunicado Concluído').closest('tr')!
    await user.click(within(linha).getByRole('button', { name: 'Editar e reenviar comunicado' }))
    expect(await screen.findByText('Editar e reenviar comunicado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }))

    await waitFor(() => expect(mailingApi.criarCampanha).toHaveBeenCalledWith(expect.objectContaining({
      assunto: 'Comunicado Concluído (reenvio)',
      corpo_html: '<p>Oi 2</p>',
    })))
    expect(mailingApi.atualizarCampanha).not.toHaveBeenCalled()
  });

  it('reenvia o público original como uma nova campanha após confirmação', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.criarCampanha).mockResolvedValue({ ...mockCampanhas[1], id: 99, status: 'rascunho' })
    vi.mocked(mailingApi.enviarCampanha).mockResolvedValue({ ok: true, message: 'Envio iniciado para 1 destinatário(s)' })
    renderWithClient()
    await abrirAbaComunicados(user)

    const linha = screen.getByText('Comunicado Concluído').closest('tr')!
    await user.click(within(linha).getByRole('button', { name: 'Reenviar comunicado' }))
    await screen.findByText('Destinatários — Comunicado Concluído')
    await user.click(await screen.findByRole('button', { name: 'Enviar para 1' }))

    await waitFor(() => expect(mailingApi.criarCampanha).toHaveBeenCalledWith(expect.objectContaining({
      assunto: 'Comunicado Concluído (reenvio)',
      destinatarios: { grupo_ids: [], contato_ids: [], emails: ['ana@exemplo.com', 'bruno@exemplo.com'], todos_ativos: false },
    })))
    await waitFor(() => expect(mailingApi.enviarCampanha).toHaveBeenCalledWith(99, expect.objectContaining({
      emails: ['ana@exemplo.com', 'bruno@exemplo.com'],
    })))
  });

  it('exclui comunicado concluído somente após confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(mailingApi.excluirCampanha).mockResolvedValue({ ok: true })
    renderWithClient()
    await abrirAbaComunicados(user)

    const linha = screen.getByText('Comunicado Concluído').closest('tr')!
    await user.click(within(linha).getByRole('button', { name: 'Excluir comunicado' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('todo o histórico de envios'))
    await waitFor(() => expect(mailingApi.excluirCampanha).toHaveBeenCalledWith(11))
  });

  it('seleciona grupos/contatos, mostra total sem duplicidade e envia a seleção', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.listGrupos).mockResolvedValue([mockGrupo])
    vi.mocked(mailingApi.enviarCampanha).mockResolvedValue({ ok: true, message: 'Envio iniciado para 5 destinatário(s)' })
    renderWithClient()
    await abrirAbaComunicados(user)

    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    await user.click(within(linha).getByTitle('Enviar'))
    expect(await screen.findByText('Destinatários — Comunicado de Outubro')).toBeInTheDocument()
    await user.click(screen.getByText(/Selecionar grupo/))
    await user.click(screen.getByRole('checkbox', { name: /Diretoria/ }))
    await user.click(screen.getByRole('button', { name: 'OK ✓' }))
    await user.click(screen.getByRole('checkbox', { name: /Ana/ }))
    expect(screen.getByText('1 destinatário(s) ativo(s), sem duplicidade')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar para 1' }))

    await waitFor(() => expect(mailingApi.enviarCampanha).toHaveBeenCalledWith(10, {
      grupo_ids: [5], contato_ids: [1], emails: [], todos_ativos: false,
    }))
    expect(window.showToast).toHaveBeenCalledWith('Envio iniciado para 5 destinatário(s)', 'success')
  });

  it('abre a confirmação com o grupo salvo no rascunho já selecionado', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.listGrupos).mockResolvedValue([mockGrupo])
    vi.mocked(mailingApi.listCampanhas).mockResolvedValue([
      { ...mockCampanhas[0], destinatarios: { grupo_ids: [5], contato_ids: [], todos_ativos: false } },
      mockCampanhas[1],
    ])
    renderWithClient()
    await abrirAbaComunicados(user)
    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    await user.click(within(linha).getByTitle('Enviar'))

    await user.click(await screen.findByText(/grupo\(s\) selecionado\(s\)/))
    expect(await screen.findByRole('checkbox', { name: /Diretoria/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Enviar para 1' })).toBeEnabled()
  });

  it('mantém e-mail individual salvo ao confirmar o envio', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.listCampanhas).mockResolvedValue([
      { ...mockCampanhas[0], destinatarios: { grupo_ids: [], contato_ids: [], emails: ['externo@exemplo.com'], todos_ativos: false } },
      mockCampanhas[1],
    ])
    vi.mocked(mailingApi.enviarCampanha).mockResolvedValue({ ok: true, message: 'Envio iniciado para 1 destinatário(s)' })
    renderWithClient()
    await abrirAbaComunicados(user)
    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    await user.click(within(linha).getByTitle('Enviar'))
    expect(await screen.findByText('externo@exemplo.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar para 1' }))

    await waitFor(() => expect(mailingApi.enviarCampanha).toHaveBeenCalledWith(10, {
      grupo_ids: [], contato_ids: [], emails: ['externo@exemplo.com'], todos_ativos: false,
    }))
  });

  it('não permite envio sem selecionar destinatários', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)
    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    await user.click(within(linha).getByTitle('Enviar'))
    expect(await screen.findByText('0 destinatário(s) ativo(s), sem duplicidade')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar para 0' })).toBeDisabled()
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

  it('mostra a barra de progresso com o total processado da campanha', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await abrirAbaComunicados(user)

    await user.click(screen.getByText('Comunicado Concluído'))

    const barra = await screen.findByRole('progressbar', { name: 'Progresso do envio: 100%' })
    expect(barra).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('2 / 2 processados')).toBeInTheDocument()
  });

  it('marca como concluída quando todos os destinatários foram processados', async () => {
    const user = userEvent.setup()
    vi.mocked(mailingApi.listCampanhas).mockResolvedValue([
      { ...mockCampanhas[0], status: 'enviando', total_destinatarios: 1, total_enviados: 1, total_falhas: 0 },
      mockCampanhas[1],
    ])
    renderWithClient()
    await abrirAbaComunicados(user)

    const linha = screen.getByText('Comunicado de Outubro').closest('tr')!
    expect(within(linha).getByText('✅ Concluída')).toBeInTheDocument()
    await user.click(within(linha).getByText('Comunicado de Outubro'))
    expect(await screen.findByRole('progressbar', { name: 'Progresso do envio: 100%' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar envio' })).not.toBeInTheDocument()
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

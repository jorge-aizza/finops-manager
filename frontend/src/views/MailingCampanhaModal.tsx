import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CmsMultiSelect from '../components/CmsMultiSelect'
import { atualizarCampanha, atualizarTemplate, criarCampanha, enviarTesteCampanha, excluirTemplate, listContatos, listGrupos, listTemplates, salvarTemplate } from '../api/mailing'
import type { MailingCampanha, MailingSelecaoDestinatarios, MailingTemplate } from '../types/mailing'
import MailingComposer from '../components/MailingComposer'
import { buildTemplatePadraoFinOps } from '../lib/mailingTemplatePadrao'

interface MailingCampanhaModalProps {
  campanha: MailingCampanha | null // null = nova
  duplicar?: boolean
  onClose: () => void
  onSolicitarEnvio: (campanha: MailingCampanha) => void
}

// O modelo FinOps que veio do .msg do usuário (2026-10-16) é um template EMBUTIDO, não
// uma linha salva no banco — resolvido com `window.location.origin` certo pro ambiente
// atual (dev/prod têm domínio diferente; salvar a URL da imagem a partir do servidor
// arriscaria gravar o domínio errado). Fica sempre disponível no seletor, não é excluível.
const TEMPLATE_EMBUTIDO_ID = -1

// Só edita campanhas em rascunho — depois de "Enviar" a campanha vira histórico
// (ver painel de acompanhamento em MailingView), não dá pra voltar e mudar o texto
// de um comunicado que já saiu pra parte dos destinatários.
export default function MailingCampanhaModal({ campanha, duplicar = false, onClose, onSolicitarEnvio }: MailingCampanhaModalProps) {
  const queryClient = useQueryClient()
  const [assunto, setAssunto] = useState(campanha ? `${campanha.assunto}${duplicar ? ' (reenvio)' : ''}` : '')
  // Campanha nova começa em branco — o usuário escolhe explicitamente "Usar modelo" se
  // quiser partir de um pronto (pedido do usuário, 2026-10-16: em vez de pré-preencher
  // escondido, dar as três opções visíveis: usar modelo / salvar como modelo / criar novo).
  const [corpoHtml, setCorpoHtml] = useState(campanha?.corpo_html || '<p></p>')
  const [remetenteNome, setRemetenteNome] = useState(campanha?.remetente_nome || (campanha ? '' : 'FinOps Vivo'))
  const [remetenteEmail, setRemetenteEmail] = useState(campanha?.remetente_email || (campanha ? '' : 'finops.vivo.br@telefonica.com'))
  const [emailTeste, setEmailTeste] = useState('')
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const [seletorModeloAberto, setSeletorModeloAberto] = useState(false)
  const [modeloEmEdicao, setModeloEmEdicao] = useState<MailingTemplate | null>(null)
  const [tipoDestinatario, setTipoDestinatario] = useState<'grupo' | 'contato'>('grupo')
  const [buscaDestinatario, setBuscaDestinatario] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [emailParaIncluir, setEmailParaIncluir] = useState('')
  const [destinatarios, setDestinatarios] = useState<MailingSelecaoDestinatarios>(() => campanha?.destinatarios || {
    grupo_ids: [], contato_ids: [], emails: [], todos_ativos: false,
  })

  const templatesQuery = useQuery({ queryKey: ['mailing-templates'], queryFn: listTemplates, enabled: seletorModeloAberto })
  const gruposQuery = useQuery({ queryKey: ['mailing-grupos'], queryFn: listGrupos })
  const contatosQuery = useQuery({ queryKey: ['mailing-contatos-edicao'], queryFn: () => listContatos() })
  const grupos = gruposQuery.data || []
  const contatos = contatosQuery.data || []
  const contatosAtivos = contatos.filter((contato) => contato.status === 'ativo')
  const contatosPorId = new Map(contatosAtivos.map((contato) => [contato.id, contato]))
  const contatosPorEmail = new Map(contatos.map((contato) => [contato.email.trim().toLowerCase(), contato]))
  const emailsSelecionados = new Set<string>()
  if (!destinatarios.todos_ativos) {
    destinatarios.contato_ids.forEach((id) => {
      const contato = contatosPorId.get(id)
      if (contato) emailsSelecionados.add(contato.email.trim().toLowerCase())
    })
    grupos.filter((grupo) => destinatarios.grupo_ids.includes(grupo.id)).forEach((grupo) => {
      grupo.contato_ids.forEach((id) => {
        const contato = contatosPorId.get(id)
        if (contato) emailsSelecionados.add(contato.email.trim().toLowerCase())
      })
    })
    ;(destinatarios.emails || []).forEach((email) => {
      const normalizado = email.trim().toLowerCase()
      const cadastrado = contatosPorEmail.get(normalizado)
      if (!cadastrado || cadastrado.status === 'ativo') emailsSelecionados.add(normalizado)
    })
  }
  const totalDestinatarios = destinatarios.todos_ativos
    ? contatosAtivos.length
    : emailsSelecionados.size
  const termoAplicado = buscaAplicada.trim().toLowerCase()
  const contatosVisiveis = contatosAtivos.filter((contato) =>
    `${contato.nome || ''} ${contato.email}`.toLowerCase().includes(termoAplicado),
  ).slice(0, 200)

  function alternarContato(id: number) {
    setDestinatarios((atual) => ({
      ...atual,
      todos_ativos: false,
      contato_ids: atual.contato_ids.includes(id) ? atual.contato_ids.filter((contatoId) => contatoId !== id) : [...atual.contato_ids, id],
    }))
  }

  function incluirEmail() {
    const email = emailParaIncluir.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      window.showToast?.('Informe um endereço de e-mail válido.', 'error')
      return
    }
    const cadastrado = contatosPorEmail.get(email)
    if (cadastrado?.status === 'opt_out') {
      window.showToast?.('Este endereço está descadastrado e não pode receber comunicados.', 'warn')
      return
    }
    if (emailsSelecionados.has(email)) {
      window.showToast?.('Este e-mail já está selecionado.', 'warn')
      return
    }
    if (cadastrado) {
      setDestinatarios((atual) => ({
        ...atual,
        todos_ativos: false,
        contato_ids: [...new Set([...atual.contato_ids, cadastrado.id])],
      }))
    } else {
      setDestinatarios((atual) => ({
        ...atual,
        todos_ativos: false,
        emails: [...new Set([...(atual.emails || []), email])],
      }))
    }
    setEmailParaIncluir('')
  }

  function removerEmail(email: string) {
    setDestinatarios((atual) => ({
      ...atual,
      emails: (atual.emails || []).filter((item) => item !== email),
    }))
  }
  const templateEmbutido: MailingTemplate = {
    id: TEMPLATE_EMBUTIDO_ID, nome: 'Modelo FinOps — Governança de Recursos Órfãos',
    corpo_html: buildTemplatePadraoFinOps(), remetente_nome: 'FinOps Vivo', remetente_email: 'finops.vivo.br@telefonica.com',
    criado_por: null, criado_em: '', atualizado_em: '',
  }

  const saveMutation = useMutation({
    mutationFn: async (abrirEnvio: boolean) => {
      const input = { assunto, corpo_html: corpoHtml, remetente_email: remetenteEmail || null, remetente_nome: remetenteNome || null, destinatarios }
      if (campanha && !duplicar) {
        await atualizarCampanha(campanha.id, input)
        return { campanha: { ...campanha, ...input }, abrirEnvio }
      }
      const criada = await criarCampanha(input)
      return { campanha: { ...criada, ...input }, abrirEnvio }
    },
    onSuccess: ({ campanha: salva, abrirEnvio }) => {
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
      if (abrirEnvio) {
        onClose()
        onSolicitarEnvio(salva)
        return
      }
      window.showToast?.('Rascunho salvo.', 'success')
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar: ' + e.message, 'error'),
  })

  const testeMutation = useMutation({
    mutationFn: (id: number) => enviarTesteCampanha(id, emailTeste),
    onSuccess: (r) => window.showToast?.(r.message, 'success'),
    onError: (e: Error) => window.showToast?.('Erro ao enviar teste: ' + e.message, 'error'),
  })

  const salvarTemplateMutation = useMutation({
    mutationFn: (nome: string) => salvarTemplate({ nome, corpo_html: corpoHtml, remetente_nome: remetenteNome || null, remetente_email: remetenteEmail || null }),
    onSuccess: () => {
      window.showToast?.('Modelo salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-templates'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar modelo: ' + e.message, 'error'),
  })

  const atualizarTemplateMutation = useMutation({
    mutationFn: (modelo: MailingTemplate) => atualizarTemplate(modelo.id, {
      nome: modelo.nome,
      corpo_html: corpoHtml,
      remetente_nome: remetenteNome || null,
      remetente_email: remetenteEmail || null,
    }),
    onSuccess: (_, modelo) => {
      setModeloEmEdicao((atual) => atual?.id === modelo.id ? {
        ...atual,
        corpo_html: corpoHtml,
        remetente_nome: remetenteNome || null,
        remetente_email: remetenteEmail || null,
      } : atual)
      window.showToast?.('Alterações do modelo salvas.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-templates'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao atualizar modelo: ' + e.message, 'error'),
  })

  const excluirTemplateMutation = useMutation({
    mutationFn: (id: number) => excluirTemplate(id),
    onSuccess: () => {
      window.showToast?.('Modelo excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-templates'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir modelo: ' + e.message, 'error'),
  })

  async function handleEnviarTeste() {
    if (!emailTeste.trim()) { window.showToast?.('Informe um e-mail para o teste.', 'error'); return }
    if (!assunto.trim()) { window.showToast?.('Preencha o assunto antes de testar.', 'error'); return }
    // Precisa existir no banco pra /enviar-teste funcionar — salva (ou atualiza) o
    // rascunho primeiro, silenciosamente, sem fechar o modal.
    let id = campanha && !duplicar ? campanha.id : undefined
    if (!id) {
      const criado = await criarCampanha({ assunto, corpo_html: corpoHtml, remetente_email: remetenteEmail || null, remetente_nome: remetenteNome || null, destinatarios })
      id = criado.id
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
    } else {
      await atualizarCampanha(id, { assunto, corpo_html: corpoHtml, remetente_email: remetenteEmail || null, remetente_nome: remetenteNome || null, destinatarios })
    }
    testeMutation.mutate(id)
  }

  function handleSalvar() {
    if (!assunto.trim()) { window.showToast?.('Assunto é obrigatório.', 'error'); return }
    saveMutation.mutate(false)
  }

  function handleSalvarEEnviar() {
    if (!assunto.trim()) { window.showToast?.('Assunto é obrigatório.', 'error'); return }
    if (totalDestinatarios === 0) { window.showToast?.('Selecione ao menos um destinatário antes de enviar.', 'error'); return }
    saveMutation.mutate(true)
  }

  function handleUsarTemplate(tpl: MailingTemplate) {
    const temConteudo = corpoHtml.replace(/<[^>]+>/g, '').trim().length > 0
    if (temConteudo && !confirm(`Substituir o conteúdo atual pelo modelo "${tpl.nome}"?`)) return
    setCorpoHtml(tpl.corpo_html)
    setModeloEmEdicao(tpl.id === TEMPLATE_EMBUTIDO_ID ? null : tpl)
    if (tpl.remetente_nome) setRemetenteNome(tpl.remetente_nome)
    if (tpl.remetente_email) setRemetenteEmail(tpl.remetente_email)
    setSeletorModeloAberto(false)
  }

  function handleSalvarComoModelo() {
    const nome = window.prompt('Nome do modelo:')
    if (!nome?.trim()) return
    salvarTemplateMutation.mutate(nome.trim())
  }

  function handleAtualizarModelo() {
    if (!modeloEmEdicao) return
    if (!confirm(`Salvar as alterações no modelo "${modeloEmEdicao.nome}"? Esta ação substituirá o conteúdo atual do modelo.`)) return
    atualizarTemplateMutation.mutate(modeloEmEdicao)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 1100, width: '96vw' }}>
        <div className="modal-header">
          <span>{duplicar ? 'Editar e reenviar comunicado' : campanha ? 'Editar Comunicado' : 'Novo Comunicado'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="mc-assunto">Assunto *</label>
            <input id="mc-assunto" type="text" placeholder="Ex: Atualização do FinOps Manager — Outubro/2026"
              value={assunto} onChange={(e) => setAssunto(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="mc-rem-nome">Nome do remetente</label>
              <input id="mc-rem-nome" type="text" placeholder="Vivo FinOps" value={remetenteNome} onChange={(e) => setRemetenteNome(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="mc-rem-email">E-mail do remetente</label>
              <input id="mc-rem-email" type="email" placeholder="finops@vivo.com.br" value={remetenteEmail} onChange={(e) => setRemetenteEmail(e.target.value)} />
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', marginBottom: 8 }}>
              <strong style={{ fontSize: 12 }}>Destinatários</strong>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{totalDestinatarios} ativo(s) selecionado(s), sem duplicidade</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 5, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={destinatarios.todos_ativos === true} onChange={(event) => setDestinatarios({
                todos_ativos: event.target.checked, grupo_ids: [], contato_ids: [], emails: [],
              })} />
              <span>Todos os contatos ativos ({contatosAtivos.length})</span>
            </label>
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: tipoDestinatario === 'grupo' ? 'minmax(150px, 0.35fr) minmax(0, 1fr)' : 'minmax(150px, 0.35fr) minmax(0, 1fr) auto', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <select aria-label="Tipo de destinatário" value={tipoDestinatario} disabled={destinatarios.todos_ativos} onChange={(event) => setTipoDestinatario(event.target.value as 'grupo' | 'contato')} style={{ height: 36, minWidth: 0, boxSizing: 'border-box' }}>
                <option value="grupo">Grupo</option>
                <option value="contato">Usuário</option>
              </select>
              {tipoDestinatario === 'grupo' ? (
                <CmsMultiSelect
                  values={destinatarios.grupo_ids.map(String)}
                  options={grupos.map((grupo) => ({
                    value: String(grupo.id),
                    label: grupo.nome,
                    sublabel: `${grupo.contato_ids.filter((id) => contatosPorId.has(id)).length} ativos`,
                  }))}
                  searchPlaceholder="Buscar grupo..."
                  triggerLabel={destinatarios.grupo_ids.length ? `${destinatarios.grupo_ids.length} grupo(s) selecionado(s)` : `Selecionar grupo(s) · ${grupos.length}`}
                  loading={gruposQuery.isLoading}
                  emptyState="Nenhum grupo cadastrado."
                  onChange={(values) => setDestinatarios((atual) => ({
                    ...atual,
                    todos_ativos: false,
                    grupo_ids: values.map(Number),
                  }))}
                />
              ) : (
                <>
                  <input
                    aria-label="Buscar destinatário"
                    type="search"
                    placeholder="Nome ou e-mail do usuário"
                    value={buscaDestinatario}
                    disabled={destinatarios.todos_ativos}
                    onChange={(event) => setBuscaDestinatario(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setBuscaAplicada(buscaDestinatario) } }}
                    style={{ width: '100%', minWidth: 0, height: 36, boxSizing: 'border-box' }}
                  />
                  <button type="button" className="btn-ghost" style={{ height: 36, whiteSpace: 'nowrap' }} disabled={destinatarios.todos_ativos} onClick={() => setBuscaAplicada(buscaDestinatario)}>
                    Buscar
                  </button>
                </>
              )}
            </div>
            {tipoDestinatario === 'contato' && (
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-hover)' }}>
              {tipoDestinatario === 'contato' && contatosQuery.isLoading && <div style={{ padding: 9, fontSize: 11 }}>Carregando usuários...</div>}
              {tipoDestinatario === 'contato' && !contatosQuery.isLoading && contatosVisiveis.length === 0 && <div style={{ padding: 9, fontSize: 11, color: 'var(--text-muted)' }}>Nenhum usuário ativo encontrado.</div>}
              {tipoDestinatario === 'contato' && contatosVisiveis.map((contato) => (
                <label key={contato.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: destinatarios.todos_ativos ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={destinatarios.todos_ativos === true || destinatarios.contato_ids.includes(contato.id)} disabled={destinatarios.todos_ativos} onChange={() => alternarContato(contato.id)} />
                  <span style={{ flex: 1, minWidth: 0 }}>{contato.nome || contato.email}</span>
                  {contato.nome && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{contato.email}</span>}
                </label>
              ))}
            </div>)}
            {tipoDestinatario === 'contato' && (
              <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                <label htmlFor="mc-email-direto">Incluir e-mail individual</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                  <input
                    id="mc-email-direto"
                    type="email"
                    placeholder="nome@empresa.com.br"
                    value={emailParaIncluir}
                    disabled={destinatarios.todos_ativos}
                    onChange={(event) => setEmailParaIncluir(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); incluirEmail() } }}
                    style={{ width: '100%', minWidth: 0, height: 36, boxSizing: 'border-box' }}
                  />
                  <button type="button" className="btn-ghost" style={{ height: 36, whiteSpace: 'nowrap' }} disabled={destinatarios.todos_ativos || !emailParaIncluir.trim()} onClick={incluirEmail}>
                    + Incluir e-mail
                  </button>
                </div>
              </div>
            )}
            {(destinatarios.emails || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                {(destinatarios.emails || []).map((email) => (
                  <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 5, padding: '4px 7px', fontSize: 11 }}>
                    {email}
                    <button type="button" className="btn-icon" title={`Remover ${email}`} onClick={() => removerEmail(email)}>×</button>
                  </span>
                ))}
              </div>
            )}
            {contatosAtivos.length > 200 && tipoDestinatario === 'contato' && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Pesquise para localizar os demais usuários.</div>}
          </div>

          <div className="form-group" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Conteúdo do comunicado</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => setSeletorModeloAberto((v) => !v)}>
                  📋 Usar modelo
                </button>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                  disabled={salvarTemplateMutation.isPending} onClick={handleSalvarComoModelo}>
                  💾 Salvar como modelo
                </button>
                {modeloEmEdicao && (
                  <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                    disabled={atualizarTemplateMutation.isPending} onClick={handleAtualizarModelo}>
                    {atualizarTemplateMutation.isPending ? 'Salvando modelo...' : 'Salvar alterações no modelo'}
                  </button>
                )}
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => { if (confirm('Limpar o conteúdo e começar do zero?')) { setCorpoHtml('<p></p>'); setModeloEmEdicao(null) } }}>
                  🗋 Criar novo (em branco)
                </button>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setMostrarPreview((v) => !v)}>
                  {mostrarPreview ? '✏ Voltar a editar' : '👁 Prévia'}
                </button>
              </div>
            </div>

            {seletorModeloAberto && (
              <div style={{
                position: 'absolute', top: 36, right: 0, zIndex: 20, width: 340,
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,.25)', maxHeight: 320, overflowY: 'auto',
              }}>
                <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  Modelos disponíveis
                </div>
                <ModeloItem tpl={templateEmbutido} embutido onUsar={handleUsarTemplate} />
                {templatesQuery.isLoading && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
                {(templatesQuery.data || []).map((tpl) => (
                  <ModeloItem key={tpl.id} tpl={tpl} onUsar={handleUsarTemplate}
                    onExcluir={() => { if (confirm(`Excluir o modelo "${tpl.nome}"?`)) excluirTemplateMutation.mutate(tpl.id) }} />
                ))}
              </div>
            )}

            {mostrarPreview ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, maxHeight: 560, overflowY: 'auto', background: '#f3f4f6' }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ width: '100%', maxWidth: 640, margin: '0 auto', borderCollapse: 'collapse', background: '#fff' }}>
                  <tbody>
                    <tr>
                      <td className="mailing-table-surface" valign="top" style={{ padding: '16px 24px', color: '#1f2937', fontFamily: 'Arial,Helvetica,sans-serif', fontSize: 14, lineHeight: '21px', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: corpoHtml }} />
                    </tr>
                    <tr>
                      <td align="center" style={{ padding: '16px 24px', background: '#f9fafb', borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontFamily: 'Arial,Helvetica,sans-serif', fontSize: 11, textAlign: 'center' }}>
                        Você está recebendo este comunicado da Vivo FinOps.{' '}
                        <span style={{ color: '#9ca3af', textDecoration: 'underline' }}>Descadastrar-se</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <MailingComposer value={corpoHtml} onChange={setCorpoHtml} editable />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 14px', background: 'var(--bg-hover)', borderRadius: 8 }}>
            <input type="email" placeholder="seu-email@vivo.com.br" value={emailTeste} onChange={(e) => setEmailTeste(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
            <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }}
              disabled={testeMutation.isPending} onClick={handleEnviarTeste}>
              {testeMutation.isPending ? 'Enviando...' : '📧 Enviar teste'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Sempre envie um teste pra si mesmo antes de disparar pra lista inteira.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-ghost" disabled={saveMutation.isPending} onClick={handleSalvarEEnviar}>
            {saveMutation.isPending && saveMutation.variables ? 'Preparando envio...' : 'Enviar comunicado'}
          </button>
          <button className="btn-primary" disabled={saveMutation.isPending} onClick={handleSalvar}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar rascunho'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeloItem({ tpl, embutido, onUsar, onExcluir }: { tpl: MailingTemplate; embutido?: boolean; onUsar: (t: MailingTemplate) => void; onExcluir?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
      <button type="button" onClick={() => onUsar(tpl)} style={{
        flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12, padding: 0,
      }}>
        {tpl.nome}{embutido && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)' }}>PADRÃO</span>}
      </button>
      {!embutido && onExcluir && (
        <button type="button" className="btn-icon delete" title="Excluir modelo" onClick={onExcluir} style={{ flexShrink: 0 }}>
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  )
}

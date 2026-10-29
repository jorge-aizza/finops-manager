import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  atualizarContato, cancelarCampanha, criarCampanha, criarContato, enviarCampanha, excluirCampanha, excluirContato,
  getProgressoCampanha, listCampanhas, listContatos, listEnviosCampanha, listImportLotes, reenviarFalhasCampanha,
} from '../api/mailing'
import type { MailingCampanha, MailingContatoStatus, MailingSelecaoDestinatarios } from '../types/mailing'
import MailingCampanhaModal from './MailingCampanhaModal'
import MailingEnvioModal from './MailingEnvioModal'
import MailingGrupos from './MailingGrupos'
import MailingImportModal from './MailingImportModal'

type Tab = 'destinatarios' | 'campanhas'

const STATUS_CAMP_LABEL: Record<string, { label: string; color: string }> = {
  rascunho: { label: 'Rascunho', color: 'var(--text-muted)' },
  enviando: { label: '⏳ Enviando', color: 'var(--accent)' },
  concluida: { label: '✅ Concluída', color: '#22c55e' },
}

function statusCampanhaAtual(campanha: MailingCampanha): string {
  const total = Number(campanha.total_destinatarios || 0)
  const processados = Number(campanha.total_enviados || 0) + Number(campanha.total_falhas || 0)
  return campanha.status === 'enviando' && total > 0 && processados >= total ? 'concluida' : campanha.status
}

// Botoes de barra (cabecalho de card e de acompanhamento): so o corpo da letra e
// uniformizado. A ALTURA vem do CSS e nao se mexe aqui — dentro de um flex os botoes
// esticam para a altura do mais alto, que e o `.btn-primary` (34px fixo), entao forcar
// altura nesta tela so a faria divergir das outras sem corrigir nada.
const BTN_BARRA: CSSProperties = { fontSize: 12 }
// Ja a linha de cadastro usa `align-items: flex-end`, onde nao ha esticamento: ali input
// e botao precisam de uma altura explicita em comum para encostarem na mesma base.
const ALTURA_CAMPO = 32

export default function MailingView() {
  const [tab, setTab] = useState<Tab>('destinatarios')

  return (
    <div>
      <div className="view-hero">
        <div className="page-title">📣 Mailing de Comunicados</div>
        <div className="view-hero-sub">Cadastro único de destinatários, composer visual e acompanhamento de envio</div>
      </div>

      {/* Barra de abas no padrao do sistema (.view-tabs, igual a Inventario e Databricks).
          Antes eram dois .btn-primary/.btn-ghost de 34px logo abaixo da faixa roxa, que
          disputavam atencao com o botao de acao do card ("Importar lista") a poucos pixels
          dali — exatamente o que o comentario do .view-tabs no styles.css diz que essa
          fileira compacta existe para evitar. O espacamento (16px acima, 16px abaixo) vem
          da propria classe, entao acompanha as outras telas sozinho. */}
      <div className="view-tabs" role="tablist" aria-label="Seções do Mailing" style={{ marginTop: 16 }}>
        <button role="tab" aria-current={tab === 'destinatarios' ? 'page' : undefined} onClick={() => setTab('destinatarios')}>
          Destinatários
        </button>
        <button role="tab" aria-current={tab === 'campanhas' ? 'page' : undefined} onClick={() => setTab('campanhas')}>
          Comunicados
        </button>
      </div>

      {tab === 'destinatarios' ? <DestinatariosTab /> : <CampanhasTab />}
    </div>
  )
}

// ══════════════════════════ Destinatários ══════════════════════════
function DestinatariosTab() {
  const queryClient = useQueryClient()
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState<MailingContatoStatus | ''>('')
  const [importOpen, setImportOpen] = useState(false)
  const [novoEmail, setNovoEmail] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [verLotes, setVerLotes] = useState(false)

  const contatosQuery = useQuery({
    queryKey: ['mailing-contatos', busca, status],
    queryFn: () => listContatos(busca || undefined, status || undefined),
  })
  const lotesQuery = useQuery({ queryKey: ['mailing-import-lotes'], queryFn: listImportLotes, enabled: verLotes })

  const addMutation = useMutation({
    mutationFn: () => criarContato({ email: novoEmail, nome: novoNome || undefined }),
    onSuccess: () => {
      window.showToast?.('Contato adicionado.', 'success')
      setNovoEmail(''); setNovoNome('')
      queryClient.invalidateQueries({ queryKey: ['mailing-contatos'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: MailingContatoStatus }) => atualizarContato(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mailing-contatos'] }),
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => excluirContato(id),
    onSuccess: () => {
      window.showToast?.('Contato removido.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-contatos'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const contatos = contatosQuery.data || []
  const ativos = contatos.filter((c) => c.status === 'ativo').length

  return (
    <div style={{ padding: '12px 20px 0' }}>
      <MailingGrupos />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-title">Cadastro de Destinatários</span>
          <span className="badge">{ativos} ativo(s) de {contatos.length}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginLeft: 'auto' }}>
            <button className="btn-ghost" style={BTN_BARRA} onClick={() => setVerLotes((v) => !v)}>
              📋 Histórico de importações
            </button>
            <button className="btn-primary" style={BTN_BARRA} onClick={() => setImportOpen(true)}>
              📥 Importar lista
            </button>
          </div>
        </div>

        {verLotes && (
          <div style={{ padding: '0 20px 14px' }}>
            {lotesQuery.isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
            {lotesQuery.data?.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma importação ainda.</div>}
            {(lotesQuery.data || []).map((l) => (
              <div key={l.id} style={{ fontSize: 12, padding: '4px 0', color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{l.arquivo_nome}</strong> — {new Date(l.importado_em).toLocaleString('pt-BR')} —
                {' '}{l.novos} novo(s), {l.atualizados} atualizado(s){l.invalidos ? `, ${l.invalidos} inválido(s)` : ''}
                {l.importado_por ? ` · ${l.importado_por}` : ''}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '0 20px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label htmlFor="mc-novo-nome" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nome (opcional)</label>
            <input id="mc-novo-nome" type="text" value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
              style={{ width: '100%', fontSize: 12, height: ALTURA_CAMPO, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor="mc-novo-email" style={{ fontSize: 11, color: 'var(--text-muted)' }}>E-mail</label>
            <input id="mc-novo-email" type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)}
              style={{ width: '100%', fontSize: 12, height: ALTURA_CAMPO, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
          </div>
          <button className="btn-ghost" style={{ fontSize: 12, height: ALTURA_CAMPO, padding: '0 16px' }} disabled={!novoEmail.trim() || addMutation.isPending}
            onClick={() => addMutation.mutate()}>
            + Adicionar
          </button>
        </div>

        <div style={{ padding: '0 20px 14px', display: 'flex', gap: 8 }}>
          <input type="text" placeholder="Buscar por e-mail ou nome..." value={busca} onChange={(e) => setBusca(e.target.value)}
            className="filter-input" style={{ flex: 1, minWidth: 220 }} />
          <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value as MailingContatoStatus | '')}>
            <option value="">Todos os status</option>
            <option value="ativo">Ativo</option>
            <option value="opt_out">Descadastrado</option>
          </select>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Grupo</th><th>Status</th><th>Origem</th><th>Ações</th></tr></thead>
            <tbody>
              {contatosQuery.isLoading && <tr><td colSpan={6} className="empty-state">Carregando...</td></tr>}
              {!contatosQuery.isLoading && contatos.length === 0 && <tr><td colSpan={6} className="empty-state">Nenhum destinatário cadastrado.</td></tr>}
              {contatos.map((c) => (
                <tr key={c.id}>
                  <td>{c.nome || '—'}</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{c.email}</td>
                  <td style={{ fontSize: 12 }}>{c.grupos?.length ? c.grupos.join(', ') : '—'}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.status === 'ativo' ? '#22c55e' : 'var(--text-muted)' }}>
                      {c.status === 'ativo' ? 'Ativo' : 'Descadastrado'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.origem === 'import' ? 'Importação' : 'Manual'}</td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon" title={c.status === 'ativo' ? 'Descadastrar' : 'Reativar'}
                        onClick={() => statusMutation.mutate({ id: c.id, status: c.status === 'ativo' ? 'opt_out' : 'ativo' })}>
                        {c.status === 'ativo' ? '🔕' : '🔔'}
                      </button>
                      <button className="btn-icon delete" title="Excluir"
                        onClick={() => { if (confirm(`Excluir ${c.email}?`)) deleteMutation.mutate(c.id) }}>
                        <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {importOpen && <MailingImportModal onClose={() => setImportOpen(false)} />}
    </div>
  )
}

// ══════════════════════════ Comunicados (campanhas) ══════════════════════════
function CampanhasTab() {
  const queryClient = useQueryClient()
  const [modalCampanha, setModalCampanha] = useState<MailingCampanha | 'nova' | null>(null)
  const [duplicarCampanha, setDuplicarCampanha] = useState(false)
  const [campanhaParaEnviar, setCampanhaParaEnviar] = useState<MailingCampanha | null>(null)
  const [reenviandoComoNova, setReenviandoComoNova] = useState(false)
  const [selecionada, setSelecionada] = useState<number | null>(null)

  const campanhasQuery = useQuery({
    queryKey: ['mailing-campanhas'],
    queryFn: listCampanhas,
    refetchInterval: (query) => query.state.data?.some((campanha) => statusCampanhaAtual(campanha) === 'enviando') ? 2000 : false,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => excluirCampanha(id),
    onSuccess: () => {
      window.showToast?.('Comunicado excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const enviarMutation = useMutation({
    mutationFn: ({ id, selecao }: { id: number; selecao: MailingSelecaoDestinatarios }) => enviarCampanha(id, selecao),
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      setCampanhaParaEnviar(null)
      setReenviandoComoNova(false)
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao enviar: ' + e.message, 'error'),
  })

  function handleEnviar(c: MailingCampanha) {
    setReenviandoComoNova(false)
    setCampanhaParaEnviar(c)
  }

  async function handleReenviar(c: MailingCampanha) {
    try {
      const envios = await listEnviosCampanha(c.id)
      if (!envios.length) {
        window.showToast?.('Este comunicado não tem destinatários para reenviar.', 'warn')
        return
      }
      setReenviandoComoNova(true)
      setCampanhaParaEnviar({
        ...c,
        destinatarios: {
          grupo_ids: [],
          contato_ids: [],
          emails: envios.map((envio) => envio.email),
          todos_ativos: false,
        },
      })
    } catch (error) {
      window.showToast?.('Erro ao preparar reenvio: ' + (error as Error).message, 'error')
    }
  }

  async function confirmarEnvio(selecao: MailingSelecaoDestinatarios) {
    if (!campanhaParaEnviar) return
    let campanha = campanhaParaEnviar
    if (reenviandoComoNova) {
      try {
        campanha = await criarCampanha({
          assunto: `${campanhaParaEnviar.assunto.replace(/ \(reenvio\)$/i, '')} (reenvio)`,
          corpo_html: campanhaParaEnviar.corpo_html,
          remetente_email: campanhaParaEnviar.remetente_email,
          remetente_nome: campanhaParaEnviar.remetente_nome,
          destinatarios: selecao,
        })
      } catch (error) {
        window.showToast?.('Erro ao criar cópia para reenvio: ' + (error as Error).message, 'error')
        return
      }
    }
    enviarMutation.mutate({ id: campanha.id, selecao })
  }

  const campanhas = campanhasQuery.data || []

  return (
    <div style={{ padding: '12px 20px 0' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Comunicados</span>
          <span className="badge">{campanhas.length}</span>
          <button className="btn-primary" style={{ ...BTN_BARRA, marginLeft: 'auto' }} onClick={() => { setDuplicarCampanha(false); setModalCampanha('nova') }}>
            + Novo Comunicado
          </button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Assunto</th><th>Status</th><th style={{ textAlign: 'right' }}>Enviados</th><th style={{ textAlign: 'right' }}>Falhas</th><th>Criado em</th><th>Ações</th></tr></thead>
            <tbody>
              {campanhasQuery.isLoading && <tr><td colSpan={6} className="empty-state">Carregando...</td></tr>}
              {!campanhasQuery.isLoading && campanhas.length === 0 && <tr><td colSpan={6} className="empty-state">Nenhum comunicado criado ainda.</td></tr>}
              {campanhas.map((c) => {
                const status = statusCampanhaAtual(c)
                const st = STATUS_CAMP_LABEL[status] || { label: status, color: 'var(--text-muted)' }
                return (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelecionada(selecionada === c.id ? null : c.id)}>
                    <td>{c.assunto}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span></td>
                    <td style={{ textAlign: 'right', color: '#22c55e', fontWeight: 700 }}>{c.total_enviados ?? 0}</td>
                    <td style={{ textAlign: 'right', color: (c.total_falhas ?? 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{c.total_falhas ?? 0}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(c.criado_em).toLocaleString('pt-BR')}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="table-actions">
                        {status === 'rascunho' && (
                          <>
                            <button className="btn-icon" title="Editar" onClick={() => { setDuplicarCampanha(false); setModalCampanha(c) }}>
                              <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                            </button>
                            <button className="btn-icon" title="Enviar" onClick={() => handleEnviar(c)}>▶</button>
                            <button className="btn-icon delete" title="Excluir" onClick={() => { if (confirm('Excluir este rascunho?')) deleteMutation.mutate(c.id) }}>
                              <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                            </button>
                          </>
                        )}
                        {status === 'concluida' && (
                          <>
                            <button className="btn-icon" title="Editar e reenviar" aria-label="Editar e reenviar comunicado"
                              onClick={() => { setDuplicarCampanha(true); setModalCampanha(c) }}>
                              <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                            </button>
                            <button className="btn-icon" title="Reenviar" aria-label="Reenviar comunicado" onClick={() => void handleReenviar(c)}>↻</button>
                            <button className="btn-icon delete" title="Excluir comunicado" aria-label="Excluir comunicado" onClick={() => {
                              if (confirm(`Excluir "${c.assunto}" e todo o histórico de envios? Esta ação não pode ser desfeita.`)) deleteMutation.mutate(c.id)
                            }}>
                              <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                            </button>
                          </>
                        )}
                        {status !== 'rascunho' && (
                          <button
                            className="btn-icon"
                            title={selecionada === c.id ? 'Ocultar acompanhamento' : 'Ver acompanhamento'}
                            aria-label={selecionada === c.id ? 'Ocultar acompanhamento' : 'Ver acompanhamento'}
                            aria-expanded={selecionada === c.id}
                            onClick={() => setSelecionada(selecionada === c.id ? null : c.id)}
                          >
                            <svg viewBox="0 0 16 16" fill="none"><path d="M2 13.5h12M4 11V8m4 3V4m4 7V6" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {selecionada !== null && <CampanhaDetalhe campanhaId={selecionada} />}
      </div>

      {modalCampanha && (
        <MailingCampanhaModal
          key={`${modalCampanha === 'nova' ? 'nova' : modalCampanha.id}-${duplicarCampanha ? 'duplicar' : 'editar'}`}
          campanha={modalCampanha === 'nova' ? null : modalCampanha}
          duplicar={duplicarCampanha}
          onClose={() => { setModalCampanha(null); setDuplicarCampanha(false) }}
          onSolicitarEnvio={(campanha) => {
            setModalCampanha(null)
            setDuplicarCampanha(false)
            setReenviandoComoNova(false)
            setCampanhaParaEnviar(campanha)
          }}
        />
      )}
      {campanhaParaEnviar && (
        <MailingEnvioModal
          campanha={campanhaParaEnviar}
          enviando={enviarMutation.isPending}
          onClose={() => { setCampanhaParaEnviar(null); setReenviandoComoNova(false) }}
          onEnviar={(selecao) => void confirmarEnvio(selecao)}
        />
      )}
    </div>
  )
}

// Painel de acompanhamento de envio — mesmo padrão de "Detalhe" expansível já usado em
// CoberturaGrid.tsx. Faz polling do progresso só enquanto a campanha está 'enviando'.
function CampanhaDetalhe({ campanhaId }: { campanhaId: number }) {
  const queryClient = useQueryClient()
  const campanhasQuery = useQuery({ queryKey: ['mailing-campanhas'], queryFn: listCampanhas })
  const campanhaOriginal = campanhasQuery.data?.find((c) => c.id === campanhaId)
  const campanha = campanhaOriginal ? { ...campanhaOriginal, status: statusCampanhaAtual(campanhaOriginal) } : undefined

  const progressoQuery = useQuery({
    queryKey: ['mailing-campanha-progresso', campanhaId],
    queryFn: () => getProgressoCampanha(campanhaId),
    refetchInterval: campanha?.status === 'enviando' ? 2000 : false,
    enabled: campanha?.status === 'enviando',
  })

  const enviosQuery = useQuery({
    queryKey: ['mailing-campanha-envios', campanhaId],
    queryFn: () => listEnviosCampanha(campanhaId),
  })
  const statusAnterior = useRef(campanha?.status)
  useEffect(() => {
    if (campanha?.status === 'concluida' && statusAnterior.current === 'enviando') {
      queryClient.invalidateQueries({ queryKey: ['mailing-campanha-envios', campanhaId] })
    }
    statusAnterior.current = campanha?.status
  }, [campanha?.status, campanhaId, queryClient])

  const cancelarMutation = useMutation({
    mutationFn: () => cancelarCampanha(campanhaId),
    onSuccess: () => window.showToast?.('Cancelamento solicitado.', 'warn'),
  })

  const reenviarMutation = useMutation({
    mutationFn: () => reenviarFalhasCampanha(campanhaId),
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
      queryClient.invalidateQueries({ queryKey: ['mailing-campanha-envios', campanhaId] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  if (!campanha) return null
  const envios = enviosQuery.data || []
  const falhas = envios.filter((e) => e.status === 'falha')
  const progresso = progressoQuery.data?.progresso || (campanha.status === 'concluida' && campanha.total_destinatarios !== undefined
    ? { total: campanha.total_destinatarios, enviados: campanha.total_enviados || 0, falhas: campanha.total_falhas || 0 }
    : null)
  const processados = progresso
    ? progresso.pendentes === undefined ? progresso.enviados + progresso.falhas : progresso.total - progresso.pendentes
    : 0
  const percentual = progresso && progresso.total > 0 ? Math.min(100, Math.round(processados / progresso.total * 100)) : 0

  return (
    <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Acompanhamento — {campanha.assunto}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {campanha.status === 'enviando' && (
            <button className="btn-ghost" style={{ ...BTN_BARRA, color: 'var(--danger)' }} onClick={() => cancelarMutation.mutate()}>
              Cancelar envio
            </button>
          )}
          {campanha.status === 'concluida' && falhas.length > 0 && (
            <button className="btn-ghost" style={{ ...BTN_BARRA, borderColor: 'var(--accent)', color: 'var(--accent)' }}
              disabled={reenviarMutation.isPending} onClick={() => reenviarMutation.mutate()}>
              🔁 Reenviar {falhas.length} falha(s)
            </button>
          )}
        </div>
      </div>

      {progresso && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            <span>{processados.toLocaleString('pt-BR')} / {progresso.total.toLocaleString('pt-BR')} processados</span>
            <span>
              <span style={{ color: '#22c55e' }}>{progresso.enviados.toLocaleString('pt-BR')} enviados</span>
              {progresso.falhas > 0 && <> · <span style={{ color: 'var(--danger)' }}>{progresso.falhas.toLocaleString('pt-BR')} falhas</span></>}
              {progresso.pendentes !== undefined && <> · {progresso.pendentes.toLocaleString('pt-BR')} pendentes</>}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Progresso do envio: ${percentual}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentual}
            style={{ height: 8, overflow: 'hidden', borderRadius: 999, background: 'var(--border)' }}
          >
            <div style={{ width: `${percentual}%`, height: '100%', borderRadius: 999, background: progresso.falhas ? 'var(--accent)' : '#22c55e', transition: 'width .3s ease' }} />
          </div>
        </div>
      )}

      <div className="table-wrapper" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>E-mail</th><th>Status</th><th>Quando</th><th>Erro</th></tr></thead>
          <tbody>
            {envios.length === 0 && <tr><td colSpan={4} className="empty-state">Sem destinatários ainda.</td></tr>}
            {envios.map((e) => (
              <tr key={e.id}>
                <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{e.email}</td>
                <td>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: e.status === 'enviado' ? '#22c55e' : e.status === 'falha' ? 'var(--danger)' : 'var(--text-muted)',
                  }}>
                    {e.status === 'enviado' ? '✅ Enviado' : e.status === 'falha' ? '❌ Falha' : '⏳ Pendente'}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.enviado_em ? new Date(e.enviado_em).toLocaleString('pt-BR') : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--danger)' }}>{e.erro || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  atualizarContato, cancelarCampanha, criarContato, enviarCampanha, excluirCampanha, excluirContato,
  getProgressoCampanha, listCampanhas, listContatos, listEnviosCampanha, listImportLotes, reenviarFalhasCampanha,
} from '../api/mailing'
import type { MailingCampanha, MailingContatoStatus } from '../types/mailing'
import MailingCampanhaModal from './MailingCampanhaModal'
import MailingImportModal from './MailingImportModal'

type Tab = 'destinatarios' | 'campanhas'

const STATUS_CAMP_LABEL: Record<string, { label: string; color: string }> = {
  rascunho: { label: 'Rascunho', color: 'var(--text-muted)' },
  enviando: { label: '⏳ Enviando', color: 'var(--accent)' },
  concluida: { label: '✅ Concluída', color: '#22c55e' },
}

export default function MailingView() {
  const [tab, setTab] = useState<Tab>('destinatarios')

  return (
    <div>
      <div className="view-hero">
        <div className="view-hero-title">📣 Mailing de Comunicados</div>
        <div className="view-hero-sub">Cadastro único de destinatários, composer visual e acompanhamento de envio</div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 20px', marginBottom: 12 }}>
        <button className={tab === 'destinatarios' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 13 }} onClick={() => setTab('destinatarios')}>
          Destinatários
        </button>
        <button className={tab === 'campanhas' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 13 }} onClick={() => setTab('campanhas')}>
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
    <div style={{ margin: '0 20px' }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-title">Cadastro de Destinatários</span>
          <span className="badge">{ativos} ativo(s) de {contatos.length}</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setVerLotes((v) => !v)}>
              📋 Histórico de importações
            </button>
            <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setImportOpen(true)}>
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
              style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor="mc-novo-email" style={{ fontSize: 11, color: 'var(--text-muted)' }}>E-mail</label>
            <input id="mc-novo-email" type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)}
              style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
          </div>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '7px 16px' }} disabled={!novoEmail.trim() || addMutation.isPending}
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
            <thead><tr><th>Nome</th><th>E-mail</th><th>Status</th><th>Origem</th><th>Ações</th></tr></thead>
            <tbody>
              {contatosQuery.isLoading && <tr><td colSpan={5} className="empty-state">Carregando...</td></tr>}
              {!contatosQuery.isLoading && contatos.length === 0 && <tr><td colSpan={5} className="empty-state">Nenhum destinatário cadastrado.</td></tr>}
              {contatos.map((c) => (
                <tr key={c.id}>
                  <td>{c.nome || '—'}</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{c.email}</td>
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
  const [selecionada, setSelecionada] = useState<number | null>(null)

  const campanhasQuery = useQuery({ queryKey: ['mailing-campanhas'], queryFn: listCampanhas })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => excluirCampanha(id),
    onSuccess: () => {
      window.showToast?.('Rascunho excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const enviarMutation = useMutation({
    mutationFn: (id: number) => enviarCampanha(id),
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao enviar: ' + e.message, 'error'),
  })

  function handleEnviar(c: MailingCampanha) {
    if (!confirm(`Enviar "${c.assunto}" para todos os contatos ativos? Depois de iniciado não é possível editar o conteúdo.`)) return
    enviarMutation.mutate(c.id)
  }

  const campanhas = campanhasQuery.data || []

  return (
    <div style={{ margin: '0 20px' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Comunicados</span>
          <span className="badge">{campanhas.length}</span>
          <button className="btn-primary" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => setModalCampanha('nova')}>
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
                const st = STATUS_CAMP_LABEL[c.status] || { label: c.status, color: 'var(--text-muted)' }
                return (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelecionada(selecionada === c.id ? null : c.id)}>
                    <td>{c.assunto}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span></td>
                    <td style={{ textAlign: 'right', color: '#22c55e', fontWeight: 700 }}>{c.total_enviados ?? 0}</td>
                    <td style={{ textAlign: 'right', color: (c.total_falhas ?? 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{c.total_falhas ?? 0}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(c.criado_em).toLocaleString('pt-BR')}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="table-actions">
                        {c.status === 'rascunho' && (
                          <>
                            <button className="btn-icon" title="Editar" onClick={() => setModalCampanha(c)}>
                              <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                            </button>
                            <button className="btn-icon" title="Enviar" onClick={() => handleEnviar(c)}>▶</button>
                            <button className="btn-icon delete" title="Excluir" onClick={() => { if (confirm('Excluir este rascunho?')) deleteMutation.mutate(c.id) }}>
                              <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                            </button>
                          </>
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
        <MailingCampanhaModal campanha={modalCampanha === 'nova' ? null : modalCampanha} onClose={() => setModalCampanha(null)} />
      )}
    </div>
  )
}

// Painel de acompanhamento de envio — mesmo padrão de "Detalhe" expansível já usado em
// CoberturaGrid.tsx. Faz polling do progresso só enquanto a campanha está 'enviando'.
function CampanhaDetalhe({ campanhaId }: { campanhaId: number }) {
  const queryClient = useQueryClient()
  const campanhasQuery = useQuery({ queryKey: ['mailing-campanhas'], queryFn: listCampanhas })
  const campanha = campanhasQuery.data?.find((c) => c.id === campanhaId)

  const progressoQuery = useQuery({
    queryKey: ['mailing-campanha-progresso', campanhaId],
    queryFn: () => getProgressoCampanha(campanhaId),
    refetchInterval: (q) => (q.state.data?.em_execucao ? 2000 : false),
    enabled: campanha?.status === 'enviando',
  })

  const enviosQuery = useQuery({
    queryKey: ['mailing-campanha-envios', campanhaId],
    queryFn: () => listEnviosCampanha(campanhaId),
    refetchInterval: campanha?.status === 'enviando' ? 3000 : false,
  })

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

  return (
    <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Acompanhamento — {campanha.assunto}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {campanha.status === 'enviando' && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }} onClick={() => cancelarMutation.mutate()}>
              Cancelar envio
            </button>
          )}
          {campanha.status === 'concluida' && falhas.length > 0 && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--accent)', color: 'var(--accent)' }}
              disabled={reenviarMutation.isPending} onClick={() => reenviarMutation.mutate()}>
              🔁 Reenviar {falhas.length} falha(s)
            </button>
          )}
        </div>
      </div>

      {progressoQuery.data?.progresso && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          {progressoQuery.data.progresso.enviados + progressoQuery.data.progresso.falhas} / {progressoQuery.data.progresso.total} processados
          {' · '}<span style={{ color: '#22c55e' }}>{progressoQuery.data.progresso.enviados} enviados</span>
          {progressoQuery.data.progresso.falhas > 0 && <> · <span style={{ color: 'var(--danger)' }}>{progressoQuery.data.progresso.falhas} falhas</span></>}
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

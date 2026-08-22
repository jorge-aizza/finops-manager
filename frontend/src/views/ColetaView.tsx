import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteHistorico, deletePendente, deleteSP, deleteStorage,
  getCoberturaMeses, getHistorico, getImports, listPendentes, listSPs, listStorages,
  setSPAtivo, setSPPadrao, setStorageAtivo,
} from '../api/coleta'
import type { HistoricoItem, ImportItem, ServicePrincipal, StorageConfig } from '../types/coleta'
import CoberturaGrid from '../components/CoberturaGrid'
import SPModal from './SPModal'
import StorageModal from './StorageModal'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

const STATUS_COLORS: Record<string, string> = {
  concluido: '#22c55e', cancelado: '#ff8c42', executando: '#ff8c42', erro: '#ff4d6a',
}

type HistTab = 'api' | 'storage' | 'manual'

export default function ColetaView() {
  const queryClient = useQueryClient()

  // ── Cobertura ──
  const coberturaQuery = useQuery({ queryKey: ['coleta-cobertura'], queryFn: () => getCoberturaMeses() })
  const refreshCobertura = useMutation({
    mutationFn: () => getCoberturaMeses(true),
    onSuccess: (data) => queryClient.setQueryData(['coleta-cobertura'], data),
  })

  const pendentesQuery = useQuery({ queryKey: ['coleta-pendentes'], queryFn: listPendentes })
  const deletePendenteMutation = useMutation({
    mutationFn: (id: number) => deletePendente(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coleta-pendentes'] }),
  })

  // ── Service Principals ──
  const spsQuery = useQuery({ queryKey: ['coleta-sps'], queryFn: listSPs })
  const [spModalOpen, setSpModalOpen] = useState(false)
  const [editingSP, setEditingSP] = useState<ServicePrincipal | null>(null)

  const deleteSPMutation = useMutation({
    mutationFn: (id: number) => deleteSP(id),
    onSuccess: () => {
      window.showToast?.('Service Principal excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-sps'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir: ' + e.message, 'error'),
  })
  const toggleSPMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) => setSPAtivo(id, ativo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coleta-sps'] }),
  })
  const padraoSPMutation = useMutation({
    mutationFn: (id: number) => setSPPadrao(id),
    onSuccess: () => {
      window.showToast?.('Service Principal definido como padrão.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-sps'] })
    },
  })

  function handleDeleteSP(sp: ServicePrincipal) {
    if (!confirm(`Excluir o Service Principal "${sp.nome}"? Esta ação não pode ser desfeita.`)) return
    deleteSPMutation.mutate(sp.id)
  }

  // ── Storage Accounts ──
  const storagesQuery = useQuery({ queryKey: ['coleta-storages'], queryFn: listStorages })
  const [storageModalOpen, setStorageModalOpen] = useState(false)
  const [editingStorage, setEditingStorage] = useState<StorageConfig | null>(null)
  const spNameById = new Map((spsQuery.data || []).map((s) => [s.id, s.nome]))

  const deleteStorageMutation = useMutation({
    mutationFn: (id: number) => deleteStorage(id),
    onSuccess: () => {
      window.showToast?.('Storage Account excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-storages'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir: ' + e.message, 'error'),
  })
  const toggleStorageMutation = useMutation({
    mutationFn: ({ storage, ativo }: { storage: StorageConfig; ativo: boolean }) => setStorageAtivo(storage, ativo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coleta-storages'] }),
  })

  function handleDeleteStorage(s: StorageConfig) {
    if (!confirm(`Excluir o Storage Account "${s.nome}"? Esta ação não pode ser desfeita.`)) return
    deleteStorageMutation.mutate(s.id)
  }

  // ── Histórico ──
  const [histTab, setHistTab] = useState<HistTab>('api')
  const historicoQuery = useQuery<(HistoricoItem | ImportItem)[]>({
    queryKey: ['coleta-historico', histTab],
    queryFn: () => (histTab === 'manual' ? getImports() : getHistorico(histTab)),
  })
  const limparHistoricoMutation = useMutation({
    mutationFn: () => deleteHistorico(),
    onSuccess: () => {
      window.showToast?.('Histórico limpo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
    },
  })

  function handleLimparHistorico() {
    if (!confirm('Limpar TODO o histórico de execuções? Esta ação não pode ser desfeita.')) return
    limparHistoricoMutation.mutate()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="view-hero">
        <div className="page-title">Coleta de Custos Azure</div>
        <div className="view-hero-sub">Service Principals, Storage Accounts, cobertura de dados e histórico de execuções</div>
      </div>

      {/* ── Cobertura por Mês ── */}
      <div className="stat-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>📊 Cobertura de Dados por Mês</span>
          <button
            className="btn-ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => refreshCobertura.mutate()}
            disabled={refreshCobertura.isPending}
            title="Atualizar (força re-consulta)"
          >
            {refreshCobertura.isPending ? 'Atualizando...' : '↻ Atualizar'}
          </button>
        </div>
        {coberturaQuery.isLoading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>
        ) : (
          <CoberturaGrid data={coberturaQuery.data || []} />
        )}

        {(pendentesQuery.data?.length ?? 0) > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
              📅 Pendentes para próximo agendamento ({pendentesQuery.data!.length})
            </div>
            {pendentesQuery.data!.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
                <span>
                  {p.descricao || `${p.data_inicio} → ${p.data_fim}`}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>SP: {p.sp_nome || '—'}</span>
                </span>
                <button className="btn-icon" title="Remover" onClick={() => deletePendenteMutation.mutate(p.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Service Principals ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Service Principals</span>
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { setEditingSP(null); setSpModalOpen(true) }}>
            Novo SP
          </button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th><th>Tenant ID</th><th>Client ID</th><th>Expira em</th><th>Ativo</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {spsQuery.isLoading && <tr><td colSpan={6} className="empty-state">Carregando...</td></tr>}
              {!spsQuery.isLoading && (spsQuery.data?.length ?? 0) === 0 && (
                <tr><td colSpan={6} className="empty-state">Nenhum Service Principal cadastrado</td></tr>
              )}
              {spsQuery.data?.map((sp) => (
                <tr key={sp.id}>
                  <td>
                    {sp.nome}
                    {sp.is_padrao && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)' }}>PADRÃO</span>}
                  </td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{sp.tenant_id.slice(0, 8)}…</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{sp.client_id.slice(0, 8)}…</td>
                  <td>{sp.expiracao_secret ? new Date(sp.expiracao_secret).toLocaleDateString('pt-BR') : '—'}</td>
                  <td>
                    <input type="checkbox" checked={sp.ativo} onChange={(e) => toggleSPMutation.mutate({ id: sp.id, ativo: e.target.checked })} />
                  </td>
                  <td>
                    <div className="table-actions">
                      {!sp.is_padrao && (
                        <button className="btn-icon" title="Definir como padrão" onClick={() => padraoSPMutation.mutate(sp.id)}>★</button>
                      )}
                      <button className="btn-icon" title="Editar" onClick={() => { setEditingSP(sp); setSpModalOpen(true) }}>
                        <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                      </button>
                      <button className="btn-icon delete" title="Excluir" onClick={() => handleDeleteSP(sp)}>
                        <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 4px 0' }}>
          Testar credenciais e coletar agora ainda estão na tela antiga — essa parte depende de chamadas reais à Azure e migra numa próxima fase.
        </div>
      </div>

      {/* ── Storage Accounts ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Storage Accounts</span>
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { setEditingStorage(null); setStorageModalOpen(true) }}>
            Novo Storage
          </button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th><th>Storage Account</th><th>Container</th><th>Prefixo</th><th>SP</th><th>Ativo</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {storagesQuery.isLoading && <tr><td colSpan={7} className="empty-state">Carregando...</td></tr>}
              {!storagesQuery.isLoading && (storagesQuery.data?.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="empty-state">Nenhum Storage Account cadastrado</td></tr>
              )}
              {storagesQuery.data?.map((s) => (
                <tr key={s.id}>
                  <td>{s.nome}</td>
                  <td>{s.storage_account}</td>
                  <td>{s.storage_container}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.storage_prefix || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.sp_id ? spNameById.get(s.sp_id) || '—' : '—'}</td>
                  <td>
                    <input type="checkbox" checked={s.ativo} onChange={(e) => toggleStorageMutation.mutate({ storage: s, ativo: e.target.checked })} />
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon" title="Editar" onClick={() => { setEditingStorage(s); setStorageModalOpen(true) }}>
                        <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                      </button>
                      <button className="btn-icon delete" title="Excluir" onClick={() => handleDeleteStorage(s)}>
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

      {/* ── Histórico de Execuções ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Histórico de Execuções</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
            <select className="filter-select" value={histTab} onChange={(e) => setHistTab(e.target.value as HistTab)}>
              <option value="api">API Oficial</option>
              <option value="storage">Via Storage</option>
              <option value="manual">Import Manual</option>
            </select>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })}>
              Atualizar
            </button>
            {histTab !== 'manual' && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }} onClick={handleLimparHistorico}>
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="table-wrapper">
          {histTab === 'manual' ? (
            <table className="data-table">
              <thead>
                <tr><th>Importado em</th><th>Arquivo</th><th style={{ textAlign: 'right' }}>Linhas</th><th>Período</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {historicoQuery.isLoading && <tr><td colSpan={5} className="empty-state">Carregando...</td></tr>}
                {!historicoQuery.isLoading && (historicoQuery.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={5} className="empty-state">Nenhuma importação encontrada</td></tr>
                )}
                {(historicoQuery.data as ImportItem[] | undefined)?.map((imp, i) => (
                  <tr key={i}>
                    <td>{formatDateTime(imp.importado_em)}</td>
                    <td>{imp.arquivo_origem}</td>
                    <td style={{ textAlign: 'right' }}>{imp.linhas.toLocaleString('pt-BR')}</td>
                    <td style={{ fontSize: 12 }}>{imp.periodo_inicio} → {imp.periodo_fim}</td>
                    <td style={{ textAlign: 'right' }}>{imp.moeda} {imp.total_billing.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Início</th><th>SP</th><th>Status</th>
                  <th style={{ textAlign: 'right' }}>Inseridos</th><th style={{ textAlign: 'right' }}>Atualizados</th><th style={{ textAlign: 'right' }}>Erros</th>
                  <th>Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {historicoQuery.isLoading && <tr><td colSpan={7} className="empty-state">Carregando...</td></tr>}
                {!historicoQuery.isLoading && (historicoQuery.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={7} className="empty-state">Nenhuma execução encontrada</td></tr>
                )}
                {(historicoQuery.data as HistoricoItem[] | undefined)?.map((h) => (
                  <tr key={h.id}>
                    <td style={{ fontSize: 12 }}>{formatDateTime(h.iniciado_em)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{h.sp_nome || '—'}</td>
                    <td>
                      <span style={{
                        background: (STATUS_COLORS[h.status] || '#7b6a9e') + '22', color: STATUS_COLORS[h.status] || '#7b6a9e',
                        border: '1px solid ' + (STATUS_COLORS[h.status] || '#7b6a9e') + '55', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      }}>
                        {h.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{h.linhas_inseridas.toLocaleString('pt-BR')}</td>
                    <td style={{ textAlign: 'right' }}>{h.linhas_atualizadas.toLocaleString('pt-BR')}</td>
                    <td style={{ textAlign: 'right', color: h.linhas_erro > 0 ? 'var(--danger)' : undefined }}>{h.linhas_erro.toLocaleString('pt-BR')}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.mensagem || ''}>
                      {h.mensagem || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {spModalOpen && <SPModal sp={editingSP} onClose={() => setSpModalOpen(false)} />}
      {storageModalOpen && <StorageModal storage={editingStorage} onClose={() => setStorageModalOpen(false)} />}
    </div>
  )
}

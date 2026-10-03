import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  coletarAPI, criarPendente, deleteHistorico, deletePendente, deleteSP, deleteStorage, executarStorage,
  getCoberturaMeses, getHistorico, getImports, listPendentes, listSPs, listStorages,
  setSPAtivo, setSPPadrao, setStorageAtivo, testarSP, testarStorage,
} from '../api/coleta'
import {
  deleteDatabricksConfig, deleteDatabricksHistorico, getDatabricksHistorico, listDatabricksConfigs,
  setDatabricksConfigAtivo, setDatabricksConfigPadrao, testarDatabricksConfig,
} from '../api/databricksColeta'
import type { HistoricoItem, ImportItem, ServicePrincipal, StorageConfig } from '../types/coleta'
import type { DatabricksConfig } from '../types/databricksColeta'
import CoberturaGrid from '../components/CoberturaGrid'
import ColetaMonitor from '../components/ColetaMonitor'
import DatabricksColetaMonitor from '../components/DatabricksColetaMonitor'
import DatabricksImportManualPanel from '../components/DatabricksImportManualPanel'
import ImportManualPanel from '../components/ImportManualPanel'
import SPModal from './SPModal'
import DatabricksConfigModal from './DatabricksConfigModal'
import DatabricksAgendamentoModal from './DatabricksAgendamentoModal'
import StorageModal from './StorageModal'
import WizardColetaModal from './WizardColetaModal'
import AgendamentoModal from './AgendamentoModal'
import DiagAgendadorModal from './DiagAgendadorModal'
import ExpurgoModal from './ExpurgoModal'
import DatabricksExpurgoModal from './DatabricksExpurgoModal'
import DiagnosticoModal from './DiagnosticoModal'
import ColetaLogModal from './ColetaLogModal'
import ColetaValidacaoModal from './ColetaValidacaoModal'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

function formatDuracao(iniciado: string, concluido: string | null): string {
  if (!iniciado || !concluido) return '—'
  const ms = new Date(concluido).getTime() - new Date(iniciado).getTime()
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const STATUS_COLORS: Record<string, string> = {
  concluido: '#22c55e', cancelado: '#ff8c42', executando: '#ff8c42', erro: '#ff4d6a',
}

const ORIGEM_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  agendado: { color: 'var(--green)', bg: 'rgba(34,197,94,.10)', label: '⏰ Agendada' },
  manual: { color: 'var(--blue)', bg: 'rgba(77,166,255,.10)', label: '👤 Manual' },
  // 'import' — só existe pra Databricks (importação manual via CSV, distinta de
  // "manual" = coleta via API disparada manualmente pelo usuário).
  import: { color: 'var(--accent)', bg: 'rgba(147,51,234,.10)', label: '📥 Import' },
}

const TIPO_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  price_list: { color: 'var(--orange)', bg: 'rgba(255,140,66,.12)', label: '💲 Price List' },
  storage: { color: 'var(--blue)', bg: 'rgba(77,166,255,.12)', label: '🗄 Storage' },
}
const TIPO_BADGE_DEFAULT = { color: 'var(--accent)', bg: 'rgba(147,51,234,.12)', label: '⚡ API' }

const VALIDACAO_BADGE: Record<string, { color: string; label: string }> = {
  ok: { color: 'var(--green)', label: '✅ OK' },
  aviso: { color: 'var(--orange)', label: '⚠ Aviso' },
  falha: { color: 'var(--danger)', label: '❌ Falha' },
  inconclusivo: { color: 'var(--text-muted)', label: '— S/dados' },
}

type HistTab = 'api' | 'storage' | 'manual' | 'databricks'

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

  // ── Ações por-célula da grade de Cobertura — porta de
  // _coberturaColetarAgora/_coberturaAgendarPendente/_coberturaGetSP (app.js) ──
  const coberturaColetarMutation = useMutation({
    mutationFn: (input: { spId: number; subId: string; inicio: string; fim: string }) =>
      coletarAPI(input.spId, { modo: 'subscription', data_inicio: input.inicio, data_fim: input.fim, subscription_ids: [input.subId], resource_groups: [], metric: 'ActualCost' }),
    onSuccess: () => {
      window.showToast?.('Coleta iniciada.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao iniciar coleta: ' + e.message, 'error'),
  })
  const coberturaAgendarMutation = useMutation({
    mutationFn: (input: { spId: number; subId: string; subName: string; inicio: string; fim: string; desc: string }) =>
      criarPendente({ sp_id: input.spId, subscription_id: input.subId, sub_name: input.subName, data_inicio: input.inicio, data_fim: input.fim, descricao: input.desc }),
    onSuccess: (_r, vars) => {
      window.showToast?.(`Agendado: ${vars.desc} — será coletado na próxima execução.`, 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-pendentes'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao agendar: ' + e.message, 'error'),
  })

  function mesKeyToRange(mesKey: string): { inicio: string; fim: string } {
    const [ano, mes] = mesKey.split('-').map(Number)
    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10)
    return { inicio, fim }
  }

  function handleCoberturaColetarAgora(mesKey: string, subId: string, subName: string) {
    const sps = (spsQuery.data || []).filter((s) => s.ativo)
    const sp = sps.find((s) => s.is_padrao) || sps[0]
    if (!sp) { window.showToast?.('Nenhuma SP ativa configurada.', 'error'); return }
    const { inicio, fim } = mesKeyToRange(mesKey)
    const [ano, mes] = mesKey.split('-')
    const desc = `${subName} — ${mes}/${ano}`
    if (!confirm(`Iniciar coleta imediata:\n\n${desc}\n\nUsando SP: ${sp.nome}\nPeríodo: ${inicio} → ${fim}`)) return
    coberturaColetarMutation.mutate({ spId: sp.id, subId, inicio, fim })
  }

  function handleCoberturaAgendarPendente(mesKey: string, subId: string, subName: string) {
    const sps = (spsQuery.data || []).filter((s) => s.ativo && s.auto_coleta)
    const sp = sps.find((s) => s.is_padrao) || sps[0]
    if (!sp) { window.showToast?.('Nenhuma SP com agendamento ativo. Configure o agendamento primeiro.', 'error'); return }
    const { inicio, fim } = mesKeyToRange(mesKey)
    const [ano, mes] = mesKey.split('-')
    const desc = `${subName} — ${mes}/${ano}`
    if (!confirm(`Incluir no próximo agendamento (uma única vez):\n\n${desc}\n\nSP: ${sp.nome}\nPeríodo: ${inicio} → ${fim}\n\nEste item será removido automaticamente após a coleta.`)) return
    coberturaAgendarMutation.mutate({ spId: sp.id, subId, subName, inicio, fim, desc })
  }

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

  const [wizardSP, setWizardSP] = useState<ServicePrincipal | null>(null)
  const [agendamentoSP, setAgendamentoSP] = useState<ServicePrincipal | null>(null)
  const [diagOpen, setDiagOpen] = useState(false)
  const [expurgoOpen, setExpurgoOpen] = useState(false)
  const [expurgoDbxOpen, setExpurgoDbxOpen] = useState(false)
  const [diagnosticoOpen, setDiagnosticoOpen] = useState(false)

  const testarSPMutation = useMutation({
    mutationFn: (id: number) => testarSP(id),
    onSuccess: (r) => window.showToast?.(r.message.replace(/\n/g, ' · '), r.results.management.ok ? 'success' : 'warn'),
    onError: (e: Error) => window.showToast?.('Erro ao testar: ' + e.message, 'error'),
  })

  // ── Coleta Databricks (Fase 1 — só configuração da conexão) ──
  const databricksQuery = useQuery({ queryKey: ['databricks-coleta-config'], queryFn: listDatabricksConfigs })
  const [dbxModalOpen, setDbxModalOpen] = useState(false)
  const [editingDbx, setEditingDbx] = useState<DatabricksConfig | null>(null)

  const deleteDbxMutation = useMutation({
    mutationFn: (id: number) => deleteDatabricksConfig(id),
    onSuccess: () => {
      window.showToast?.('Configuração Databricks excluída.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir: ' + e.message, 'error'),
  })
  const toggleDbxMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) => setDatabricksConfigAtivo(id, ativo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] }),
  })
  const padraoDbxMutation = useMutation({
    mutationFn: (id: number) => setDatabricksConfigPadrao(id),
    onSuccess: () => {
      window.showToast?.('Configuração Databricks definida como padrão.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] })
    },
  })
  const testarDbxMutation = useMutation({
    mutationFn: (id: number) => testarDatabricksConfig(id),
    onSuccess: (r) => {
      const detalhes = r.tabelas
        ? ' — ' + Object.entries(r.tabelas).map(([t, v]) => `${v.ok ? '✅' : '❌'} ${t}${v.ok ? '' : ' (' + v.message + ')'}`).join('; ')
        : ''
      // tabelas_opcionais (system.lakeflow) — alimenta só "Execuções de Job" (tempo+
      // status), nunca derruba r.ok; mostrado como um segundo toast informativo pra não
      // misturar com o resultado principal (billing/custo por recurso).
      const detalhesOpcionais = r.tabelas_opcionais
        ? ' — ' + Object.entries(r.tabelas_opcionais).map(([t, v]) => `${v.ok ? '✅' : '❌'} ${t}${v.ok ? '' : ' (' + v.message + ')'}`).join('; ')
        : ''
      window.showToast?.(r.message + detalhes, r.ok ? 'success' : 'error')
      if (r.tabelas_opcionais) {
        window.showToast?.(
          (r.opcionais_ok ? 'Execuções de Job (duração/status): disponível' : r.opcionais_aviso || 'Execuções de Job indisponível') + detalhesOpcionais,
          r.opcionais_ok ? 'success' : 'error',
        )
      }
    },
    onError: (e: Error) => window.showToast?.('Erro ao testar: ' + e.message, 'error'),
  })
  const [agendamentoDbx, setAgendamentoDbx] = useState<DatabricksConfig | null>(null)

  function handleDeleteDbx(c: DatabricksConfig) {
    if (!confirm(`Excluir a configuração Databricks "${c.nome}"? Esta ação não pode ser desfeita.`)) return
    deleteDbxMutation.mutate(c.id)
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

  const testarStorageMutation = useMutation({
    mutationFn: (id: number) => testarStorage(id),
    onSuccess: (r) => window.showToast?.(`${r.total} arquivo(s) encontrado(s) (${r.totalSizeMB} MB).`, 'success'),
    onError: (e: Error) => window.showToast?.('Erro ao testar: ' + e.message, 'error'),
  })
  const executarStorageMutation = useMutation({
    mutationFn: (id: number) => executarStorage(id),
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao executar: ' + e.message, 'error'),
  })

  // ── Histórico ──
  const [histTab, setHistTab] = useState<HistTab>('api')
  const historicoQuery = useQuery<(HistoricoItem | ImportItem)[]>({
    queryKey: ['coleta-historico', histTab],
    queryFn: () => (histTab === 'manual' ? getImports() : histTab === 'databricks' ? getDatabricksHistorico() : getHistorico(histTab)),
  })
  const limparHistoricoMutation = useMutation({
    mutationFn: () => (histTab === 'databricks' ? deleteDatabricksHistorico() : deleteHistorico()),
    onSuccess: () => {
      window.showToast?.('Histórico limpo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
    },
  })

  function handleLimparHistorico() {
    if (!confirm('Limpar TODO o histórico de execuções? Esta ação não pode ser desfeita.')) return
    limparHistoricoMutation.mutate()
  }

  const [logItem, setLogItem] = useState<HistoricoItem | null>(null)
  const [validacaoItem, setValidacaoItem] = useState<HistoricoItem | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="view-hero">
        <div className="page-title">Coleta de Custos Azure</div>
        <div className="view-hero-sub">Service Principals, Storage Accounts, cobertura de dados e histórico de execuções</div>
      </div>

      <ColetaMonitor />
      <DatabricksColetaMonitor />

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
          <CoberturaGrid
            data={coberturaQuery.data || []}
            onColetarAgora={handleCoberturaColetarAgora}
            onAgendarPendente={handleCoberturaAgendarPendente}
          />
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto' }}>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setDiagOpen(true)}>
              🔍 Diagnóstico do Agendador
            </button>
            <button className="btn-primary" onClick={() => { setEditingSP(null); setSpModalOpen(true) }}>
              Novo SP
            </button>
          </div>
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
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{(sp.tenant_id || '').slice(0, 8) || '—'}…</td>
                  <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11 }}>{(sp.client_id || '').slice(0, 8) || '—'}…</td>
                  <td>{sp.expiracao_secret ? new Date(sp.expiracao_secret).toLocaleDateString('pt-BR') : '—'}</td>
                  <td>
                    <input type="checkbox" checked={sp.ativo} onChange={(e) => toggleSPMutation.mutate({ id: sp.id, ativo: e.target.checked })} />
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon" title="Testar credenciais" disabled={testarSPMutation.isPending} onClick={() => testarSPMutation.mutate(sp.id)}>🔌</button>
                      <button className="btn-icon" title="Iniciar Coleta" onClick={() => setWizardSP(sp)}>▶</button>
                      <button className="btn-icon" title="Agendamento" onClick={() => setAgendamentoSP(sp)}>⏰</button>
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
      </div>

      {/* ── Coleta Databricks (Fase 3 — dashboard, orçamentos e alertas) ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Coleta Databricks</span>
          <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>Fase 3 — dashboard ativo</span>
          <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn-ghost" onClick={() => window.showView?.('databricks')}>📊 Ver Dashboard</button>
            <button className="btn-primary" onClick={() => { setEditingDbx(null); setDbxModalOpen(true) }}>
              Nova Configuração
            </button>
          </div>
        </div>
        <div style={{ padding: '0 20px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Custo por usuário e distinção free-tier vs. pago do Databricks vêm das System Tables do próprio
          Databricks — dado que não existe no billing da Azure. Use ⏰ para configurar agendamento recorrente
          ou coletar agora; consumo mensal, custo por workspace/SKU/usuário e orçamentos ficam no Dashboard.
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th><th>Autenticação</th><th>Workspace</th><th>Ativo</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {databricksQuery.isLoading && <tr><td colSpan={5} className="empty-state">Carregando...</td></tr>}
              {!databricksQuery.isLoading && (databricksQuery.data?.length ?? 0) === 0 && (
                <tr><td colSpan={5} className="empty-state">Nenhuma configuração Databricks cadastrada</td></tr>
              )}
              {databricksQuery.data?.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.nome}
                    {c.is_padrao && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)' }}>PADRÃO</span>}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {c.modo_auth === 'pat' ? (
                      <span>🔑 PAT</span>
                    ) : (
                      <span title={c.client_id || ''} style={{ fontFamily: "'IBM Plex Mono',monospace" }}>OAuth M2M · {(c.client_id || '').slice(0, 8) || '—'}…</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.workspace_host}>{c.workspace_host}</td>
                  <td>
                    <input type="checkbox" checked={c.ativo} onChange={(e) => toggleDbxMutation.mutate({ id: c.id, ativo: e.target.checked })} />
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon" title="Testar conexão" disabled={testarDbxMutation.isPending} onClick={() => testarDbxMutation.mutate(c.id)}>🔌</button>
                      <button className="btn-icon" title="Agendamento" onClick={() => setAgendamentoDbx(c)}>⏰</button>
                      {!c.is_padrao && (
                        <button className="btn-icon" title="Definir como padrão" onClick={() => padraoDbxMutation.mutate(c.id)}>★</button>
                      )}
                      <button className="btn-icon" title="Editar" onClick={() => { setEditingDbx(c); setDbxModalOpen(true) }}>
                        <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                      </button>
                      <button className="btn-icon delete" title="Excluir" onClick={() => handleDeleteDbx(c)}>
                        <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DatabricksImportManualPanel />
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
                      <button className="btn-icon" title="Testar acesso" disabled={testarStorageMutation.isPending} onClick={() => testarStorageMutation.mutate(s.id)}>🔌</button>
                      <button className="btn-icon" title="Executar agora" disabled={executarStorageMutation.isPending} onClick={() => executarStorageMutation.mutate(s.id)}>▶</button>
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

      <ImportManualPanel />

      {/* ── Histórico de Execuções ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Histórico de Execuções</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
            <select className="filter-select" value={histTab} onChange={(e) => setHistTab(e.target.value as HistTab)}>
              <option value="api">API Oficial</option>
              <option value="storage">Via Storage</option>
              <option value="manual">Import Manual</option>
              <option value="databricks">Coleta Databricks</option>
            </select>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })}>
              Atualizar
            </button>
            {histTab !== 'manual' && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }} onClick={handleLimparHistorico}>
                Limpar
              </button>
            )}
            {histTab === 'manual' && (
              <>
                <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setDiagnosticoOpen(true)}>
                  🔍 Diagnóstico
                </button>
                <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => setExpurgoOpen(true)}>
                  🗑 Limpar Dados
                </button>
              </>
            )}
            {histTab === 'databricks' && (
              <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={() => setExpurgoDbxOpen(true)}>
                🗑 Limpar Dados
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
                  <th>Início</th><th>{histTab === 'databricks' ? 'Configuração' : 'SP'}</th>{histTab === 'storage' && <th>Tipo</th>}<th>Status</th><th>Origem</th>
                  <th style={{ textAlign: 'right' }}>Inseridos</th><th style={{ textAlign: 'right' }}>Atualizados</th><th style={{ textAlign: 'right' }}>Erros</th>
                  <th>Duração</th><th>Mensagem</th><th style={{ textAlign: 'center' }}>Validação</th><th style={{ textAlign: 'center' }}>Log</th>
                </tr>
              </thead>
              <tbody>
                {historicoQuery.isLoading && <tr><td colSpan={11} className="empty-state">Carregando...</td></tr>}
                {!historicoQuery.isLoading && (historicoQuery.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={11} className="empty-state">Nenhuma execução encontrada</td></tr>
                )}
                {(historicoQuery.data as HistoricoItem[] | undefined)?.map((h) => {
                  const origem = h.origem ? ORIGEM_BADGE[h.origem] : null
                  const tipoBadge = h.tipo ? (TIPO_BADGE[h.tipo] || TIPO_BADGE_DEFAULT) : TIPO_BADGE_DEFAULT
                  const temLog = !!h.detalhes?.log?.length
                  const val = h.validacao_status ? VALIDACAO_BADGE[h.validacao_status] : null
                  return (
                    <tr key={h.id}>
                      <td style={{ fontSize: 12 }}>{formatDateTime(h.iniciado_em)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{h.sp_nome || '—'}</td>
                      {histTab === 'storage' && (
                        <td>
                          <span style={{ background: tipoBadge.bg, color: tipoBadge.color, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>
                            {tipoBadge.label}
                          </span>
                        </td>
                      )}
                      <td>
                        <span style={{
                          background: (STATUS_COLORS[h.status] || '#7b6a9e') + '22', color: STATUS_COLORS[h.status] || '#7b6a9e',
                          border: '1px solid ' + (STATUS_COLORS[h.status] || '#7b6a9e') + '55', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        }}>
                          {h.status}
                        </span>
                      </td>
                      <td>
                        {origem ? (
                          <span style={{ background: origem.bg, color: origem.color, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>{origem.label}</span>
                        ) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{h.linhas_inseridas.toLocaleString('pt-BR')}</td>
                      <td style={{ textAlign: 'right' }}>{h.linhas_atualizadas.toLocaleString('pt-BR')}</td>
                      <td style={{ textAlign: 'right', color: h.linhas_erro > 0 ? 'var(--danger)' : undefined }}>{h.linhas_erro.toLocaleString('pt-BR')}</td>
                      <td style={{ fontSize: 11 }}>{formatDuracao(h.iniciado_em, h.concluido_em)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.mensagem || ''}>
                        {h.mensagem || '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {val ? (
                          <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px', borderColor: val.color, color: val.color }} onClick={() => setValidacaoItem(h)}>
                            {val.label}
                          </button>
                        ) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {temLog ? (
                          <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px', borderColor: 'var(--accent)', color: 'var(--accent)' }} title="Ver log passo a passo" onClick={() => setLogItem(h)}>
                            📋 Log
                          </button>
                        ) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {spModalOpen && <SPModal sp={editingSP} onClose={() => setSpModalOpen(false)} />}
      {dbxModalOpen && <DatabricksConfigModal config={editingDbx} onClose={() => setDbxModalOpen(false)} />}
      {agendamentoDbx && <DatabricksAgendamentoModal config={agendamentoDbx} onClose={() => setAgendamentoDbx(null)} />}
      {storageModalOpen && <StorageModal storage={editingStorage} onClose={() => setStorageModalOpen(false)} />}
      {wizardSP && <WizardColetaModal sp={wizardSP} onClose={() => setWizardSP(null)} />}
      {agendamentoSP && <AgendamentoModal sp={agendamentoSP} onClose={() => setAgendamentoSP(null)} />}
      {diagOpen && <DiagAgendadorModal onClose={() => setDiagOpen(false)} />}
      {expurgoOpen && <ExpurgoModal onClose={() => setExpurgoOpen(false)} />}
      {expurgoDbxOpen && <DatabricksExpurgoModal onClose={() => setExpurgoDbxOpen(false)} />}
      {diagnosticoOpen && <DiagnosticoModal onClose={() => setDiagnosticoOpen(false)} />}
      {logItem && <ColetaLogModal item={logItem} onClose={() => setLogItem(null)} />}
      {validacaoItem && <ColetaValidacaoModal item={validacaoItem} fonte={histTab === 'databricks' ? 'databricks' : 'azure'} onClose={() => setValidacaoItem(null)} />}
    </div>
  )
}

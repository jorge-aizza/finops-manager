import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createSP, listarSubsPreview, listarSubsSP, updateSP } from '../api/coleta'
import CheckboxSearchList from '../components/CheckboxSearchList'
import type { ModoColeta, ServicePrincipal, ServicePrincipalInput } from '../types/coleta'

interface FormState {
  nome: string
  expiracao_secret: string
  tenant_id: string
  client_id: string
  client_secret: string
  modo_coleta: ModoColeta
  billing_account_id: string
  billing_profile_id: string
  ativo: boolean
}

function emptyForm(): FormState {
  return {
    nome: '', expiracao_secret: '', tenant_id: '', client_id: '', client_secret: '',
    modo_coleta: 'billing_profile', billing_account_id: '', billing_profile_id: '', ativo: true,
  }
}

function fromSP(sp: ServicePrincipal): FormState {
  return {
    nome: sp.nome || '',
    expiracao_secret: sp.expiracao_secret ? sp.expiracao_secret.split('T')[0] : '',
    tenant_id: sp.tenant_id || '',
    client_id: sp.client_id || '',
    client_secret: '',
    modo_coleta: sp.modo_coleta || 'billing_profile',
    billing_account_id: sp.billing_account_id || '',
    billing_profile_id: sp.billing_profile_id || '',
    ativo: sp.ativo,
  }
}

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10) }

const GRAN_FIXAS = ['7', '15', '30']

function diasEntre(de: string, ate: string): number {
  if (!de || !ate) return 0
  return Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 86400000) + 1
}

interface SPModalProps {
  sp: ServicePrincipal | null
  onClose: () => void
}

// Fase B — CRUD (Fase A) + seletor de subscriptions ao vivo pra modo_coleta
// "subscription" (porta de spBuscarSubs/app.js:4898+). SP existente: busca
// via a própria SP salva (listarSubsSP). SP nova: precisa das credenciais já
// preenchidas no formulário (listarSubsPreview, sem precisar salvar antes —
// mesmo endpoint que o wizard usa pra pré-visualizar).
export default function SPModal({ sp, onClose }: SPModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (sp ? fromSP(sp) : emptyForm()))
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(
    () => new Set((sp?.subscription_ids || '').split(',').map((s) => s.trim()).filter(Boolean)),
  )

  // Granularidade de coleta (7/15/30/Livre) — porta de spGranToggle/
  // spGranCalcDias/_getGran/_setGran (app.js:4970-5046). "Livre" deixa o
  // usuário escolher um intervalo de datas em vez de um preset; o valor
  // salvo é sempre um inteiro de dias (diff das datas + 1 no modo Livre).
  const granInicial = sp?.granularidade_dias ?? 7
  const [granModo, setGranModo] = useState<'fixa' | 'livre'>(GRAN_FIXAS.includes(String(granInicial)) ? 'fixa' : 'livre')
  const [granFixa, setGranFixa] = useState(GRAN_FIXAS.includes(String(granInicial)) ? String(granInicial) : '7')
  const [granAte, setGranAte] = useState(() => {
    const ate = new Date(); ate.setDate(ate.getDate() - 1)
    return fmtDate(ate)
  })
  const [granDe, setGranDe] = useState(() => {
    const ate = new Date(); ate.setDate(ate.getDate() - 1)
    const de = new Date(ate); de.setDate(de.getDate() - (granInicial - 1))
    return fmtDate(de)
  })
  const granDiasLivre = diasEntre(granDe, granAte)

  function handleGranModoChange(v: string) {
    if (v === '0') { setGranModo('livre'); return }
    setGranModo('fixa'); setGranFixa(v)
  }

  const subsQuery = useQuery({
    queryKey: sp ? ['sp-modal-subs', sp.id] : ['sp-modal-subs-preview', form.tenant_id, form.client_id, form.client_secret],
    queryFn: () => (sp
      ? listarSubsSP(sp.id)
      : listarSubsPreview({ tenant_id: form.tenant_id, client_id: form.client_id, client_secret: form.client_secret })),
    enabled: form.modo_coleta === 'subscription' && (!!sp || !!(form.tenant_id && form.client_id && form.client_secret)),
    retry: false,
  })
  const subItems = (subsQuery.data?.subs || []).map((s) => ({ id: s.subscriptionId, label: s.nome }))

  function toggleSub(id: string, checked: boolean) {
    setSelectedSubs((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n })
  }

  const saveMutation = useMutation({
    mutationFn: (input: ServicePrincipalInput) => (sp ? updateSP(sp.id, input) : createSP(input)),
    onSuccess: () => {
      window.showToast?.('Service Principal salvo com sucesso!', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-sps'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar Service Principal: ' + e.message, 'error'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.nome || !form.tenant_id || !form.client_id) {
      window.showToast?.('Preencha Nome, Tenant ID e Client ID.', 'error')
      return
    }
    if (form.modo_coleta === 'billing_profile' && (!form.billing_account_id || !form.billing_profile_id)) {
      window.showToast?.('Informe Billing Account ID e Billing Profile ID.', 'error')
      return
    }
    if (granModo === 'livre' && granDiasLivre < 1) {
      window.showToast?.('Data fim deve ser após data início na granularidade.', 'error')
      return
    }
    const input: ServicePrincipalInput = {
      nome: form.nome,
      tenant_id: form.tenant_id,
      client_id: form.client_id,
      expiracao_secret: form.expiracao_secret || null,
      modo_coleta: form.modo_coleta,
      billing_account_id: form.modo_coleta === 'billing_profile' ? form.billing_account_id : null,
      billing_profile_id: form.modo_coleta === 'billing_profile' ? form.billing_profile_id : null,
      subscription_ids: form.modo_coleta === 'subscription' ? ([...selectedSubs].join(',') || null) : (sp?.subscription_ids ?? null),
      ativo: form.ativo,
      dia_execucao: sp?.dia_execucao ?? 5,
      granularidade_dias: granModo === 'fixa' ? parseInt(granFixa, 10) : Math.max(1, granDiasLivre),
    }
    if (form.client_secret) input.client_secret = form.client_secret
    saveMutation.mutate(input)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>{sp ? 'Editar Service Principal' : 'Novo Service Principal'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form id="sp-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="sp-nome">Nome *</label>
              <input id="sp-nome" type="text" required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sp-tenant-id">Tenant ID *</label>
              <input id="sp-tenant-id" type="text" required value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sp-client-id">Client ID *</label>
              <input id="sp-client-id" type="text" required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sp-client-secret">Client Secret {sp && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(deixe em branco pra manter o atual)</span>}</label>
              <input
                id="sp-client-secret" type="password" value={form.client_secret}
                placeholder={sp ? '••••••••  (já cadastrado)' : ''}
                onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="sp-expiracao">Expiração do Secret</label>
              <input id="sp-expiracao" type="date" value={form.expiracao_secret} onChange={(e) => setForm({ ...form, expiracao_secret: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sp-modo-coleta">Modo de Coleta *</label>
              <select id="sp-modo-coleta" value={form.modo_coleta} onChange={(e) => setForm({ ...form, modo_coleta: e.target.value as ModoColeta })}>
                <option value="billing_profile">Billing Profile</option>
                <option value="subscription">Subscription</option>
              </select>
            </div>
            {form.modo_coleta === 'billing_profile' ? (
              <>
                <div className="form-group">
                  <label htmlFor="sp-billing-account">Billing Account ID *</label>
                  <input id="sp-billing-account" type="text" value={form.billing_account_id} onChange={(e) => setForm({ ...form, billing_account_id: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="sp-billing-profile">Billing Profile ID *</label>
                  <input id="sp-billing-profile" type="text" value={form.billing_profile_id} onChange={(e) => setForm({ ...form, billing_profile_id: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="form-group">
                <label>Subscriptions *</label>
                {!sp && !(form.tenant_id && form.client_id && form.client_secret) && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
                    Preencha Tenant ID, Client ID e Client Secret acima pra listar as assinaturas disponíveis.
                  </div>
                )}
                {(sp || (form.tenant_id && form.client_id && form.client_secret)) && (
                  <CheckboxSearchList
                    items={subItems} selected={selectedSubs} onToggle={toggleSub}
                    onSelectAll={(c) => setSelectedSubs(c ? new Set(subItems.map((i) => i.id)) : new Set())}
                    loading={subsQuery.isLoading}
                    emptyText={subsQuery.isError ? 'Não foi possível listar — verifique as credenciais.' : 'Nenhuma assinatura encontrada.'}
                  />
                )}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="sp-granularidade">Granularidade de coleta</label>
              <select id="sp-granularidade" value={granModo === 'livre' ? '0' : granFixa} onChange={(e) => handleGranModoChange(e.target.value)}>
                <option value="7">7 dias</option>
                <option value="15">15 dias</option>
                <option value="30">30 dias</option>
                <option value="0">Livre (escolher período)</option>
              </select>
              {granModo === 'livre' && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="date" value={granDe} onChange={(e) => setGranDe(e.target.value)} style={{ flex: 1 }} />
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <input type="date" value={granAte} onChange={(e) => setGranAte(e.target.value)} style={{ flex: 1 }} />
                  </div>
                  <div style={{ fontSize: 11, color: granDiasLivre < 1 ? 'var(--danger)' : 'var(--accent)' }}>
                    {granDiasLivre < 1
                      ? '⚠ Data fim deve ser após data início'
                      : `${granDiasLivre} dia${granDiasLivre !== 1 ? 's' : ''} selecionado${granDiasLivre !== 1 ? 's' : ''}`}
                  </div>
                </div>
              )}
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="sp-ativo" type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} style={{ width: 'auto' }} />
              <label htmlFor="sp-ativo" style={{ margin: 0 }}>Ativo</label>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="sp-form" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

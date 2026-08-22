import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createSP, updateSP } from '../api/coleta'
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

interface SPModalProps {
  sp: ServicePrincipal | null
  onClose: () => void
}

// Só o CRUD básico (Fase A) — sem o seletor de subscriptions (modo_coleta
// "subscription" exige subscription_ids, que depende de buscar assinaturas
// reais na Azure via testarSP/spBuscarSubs — Fase B).
export default function SPModal({ sp, onClose }: SPModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (sp ? fromSP(sp) : emptyForm()))

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
    const input: ServicePrincipalInput = {
      nome: form.nome,
      tenant_id: form.tenant_id,
      client_id: form.client_id,
      expiracao_secret: form.expiracao_secret || null,
      modo_coleta: form.modo_coleta,
      billing_account_id: form.modo_coleta === 'billing_profile' ? form.billing_account_id : null,
      billing_profile_id: form.modo_coleta === 'billing_profile' ? form.billing_profile_id : null,
      subscription_ids: sp?.subscription_ids ?? null, // preservado — seleção via wizard (Fase B)
      ativo: form.ativo,
      dia_execucao: sp?.dia_execucao ?? 5,
      granularidade_dias: sp?.granularidade_dias ?? 7,
    }
    if (form.client_secret) input.client_secret = form.client_secret
    saveMutation.mutate(input)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>{sp ? 'Editar Service Principal' : 'Novo Service Principal'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
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
              <input id="sp-client-secret" type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
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
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                Seleção de Subscriptions é feita pelo wizard de coleta (ainda não migrado) — a seleção já
                salva neste SP é preservada ao editar os outros campos aqui.
              </div>
            )}
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

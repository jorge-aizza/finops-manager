import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDatabricksConfig, updateDatabricksConfig } from '../api/databricksColeta'
import type { DatabricksAuthMode, DatabricksConfig, DatabricksConfigInput } from '../types/databricksColeta'

interface FormState {
  nome: string
  modo_auth: DatabricksAuthMode
  account_id: string
  client_id: string
  client_secret: string
  token: string
  workspace_host: string
  warehouse_id: string
  ativo: boolean
}

function emptyForm(): FormState {
  return {
    nome: '', modo_auth: 'oauth_m2m', account_id: '', client_id: '', client_secret: '', token: '',
    workspace_host: '', warehouse_id: '', ativo: true,
  }
}

function fromConfig(c: DatabricksConfig): FormState {
  return {
    nome: c.nome || '', modo_auth: c.modo_auth || 'oauth_m2m', account_id: c.account_id || '', client_id: c.client_id || '',
    client_secret: '', token: '', workspace_host: c.workspace_host || '', warehouse_id: c.warehouse_id || '', ativo: c.ativo,
  }
}

interface DatabricksConfigModalProps {
  config: DatabricksConfig | null
  onClose: () => void
}

// Fase 1 — configuração da conexão. Porta de SPModal.tsx (Coleta Azure), sem os campos de
// agendamento (dia/hora_execucao, granularidade_dias) — esses só fazem sentido a partir
// da Fase 2, quando a coleta agendada de verdade existir.
// Dois modos de autenticação (2026-08-26, pedido do usuário): OAuth M2M (Service
// Principal da conta Databricks — precisa de acesso de account admin pra criar) ou
// Personal Access Token (mais simples — qualquer usuário/SP de workspace gera o seu).
export default function DatabricksConfigModal({ config, onClose }: DatabricksConfigModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (config ? fromConfig(config) : emptyForm()))
  const isPat = form.modo_auth === 'pat'

  const saveMutation = useMutation({
    mutationFn: (input: DatabricksConfigInput) => (config ? updateDatabricksConfig(config.id, input) : createDatabricksConfig(input)),
    onSuccess: () => {
      window.showToast?.('Configuração Databricks salva com sucesso!', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar configuração Databricks: ' + e.message, 'error'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.nome || !form.workspace_host || !form.warehouse_id) {
      window.showToast?.('Preencha Nome, Workspace Host e Warehouse ID.', 'error')
      return
    }
    if (isPat) {
      if (!config && !form.token) {
        window.showToast?.('Token é obrigatório para uma configuração nova.', 'error')
        return
      }
    } else {
      if (!form.account_id || !form.client_id) {
        window.showToast?.('Preencha Account ID e Client ID.', 'error')
        return
      }
      if (!config && !form.client_secret) {
        window.showToast?.('Client Secret é obrigatório para uma configuração nova.', 'error')
        return
      }
    }
    const input: DatabricksConfigInput = {
      nome: form.nome, modo_auth: form.modo_auth,
      workspace_host: form.workspace_host, warehouse_id: form.warehouse_id, ativo: form.ativo,
    }
    if (isPat) {
      if (form.token) input.token = form.token
    } else {
      input.account_id = form.account_id
      input.client_id = form.client_id
      if (form.client_secret) input.client_secret = form.client_secret
    }
    saveMutation.mutate(input)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>{config ? 'Editar Configuração Databricks' : 'Nova Configuração Databricks'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form id="dbx-config-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="dbx-nome">Nome *</label>
              <input id="dbx-nome" type="text" required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="dbx-modo-auth">Modo de autenticação *</label>
              <select id="dbx-modo-auth" value={form.modo_auth} onChange={(e) => setForm({ ...form, modo_auth: e.target.value as DatabricksAuthMode })}>
                <option value="oauth_m2m">OAuth M2M (Service Principal da conta)</option>
                <option value="pat">Personal Access Token</option>
              </select>
            </div>

            {isPat ? (
              <div className="form-group">
                <label htmlFor="dbx-token">Personal Access Token * {config && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(deixe em branco pra manter o atual)</span>}</label>
                <input id="dbx-token" type="password" placeholder="dapiXXXXXXXXXXXXXXXXXXXXXXXXXXXX" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gerado em User Settings → Developer → Access tokens (seu usuário ou um Service Principal de workspace).</span>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="dbx-account-id">Account ID *</label>
                  <input id="dbx-account-id" type="text" placeholder="ID da conta Databricks (UUID)" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="dbx-client-id">Client ID *</label>
                  <input id="dbx-client-id" type="text" placeholder="Service Principal (OAuth M2M)" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="dbx-client-secret">Client Secret {config && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(deixe em branco pra manter o atual)</span>}</label>
                  <input id="dbx-client-secret" type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
                </div>
              </>
            )}

            <div className="form-group">
              <label htmlFor="dbx-workspace-host">Workspace Host *</label>
              <input id="dbx-workspace-host" type="text" required placeholder="https://adb-XXXXXXXXXXXX.NN.azuredatabricks.net" value={form.workspace_host} onChange={(e) => setForm({ ...form, workspace_host: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="dbx-warehouse-id">SQL Warehouse ID *</label>
              <input id="dbx-warehouse-id" type="text" required placeholder="Usado pra rodar as queries de billing (System Tables)" value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="dbx-ativo" type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} style={{ width: 'auto' }} />
              <label htmlFor="dbx-ativo" style={{ margin: 0 }}>Ativo</label>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="dbx-config-form" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

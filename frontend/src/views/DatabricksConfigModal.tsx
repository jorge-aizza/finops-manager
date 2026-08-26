import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDatabricksConfig, updateDatabricksConfig } from '../api/databricksColeta'
import type { DatabricksConfig, DatabricksConfigInput } from '../types/databricksColeta'

interface FormState {
  nome: string
  account_id: string
  client_id: string
  client_secret: string
  workspace_host: string
  warehouse_id: string
  ativo: boolean
}

function emptyForm(): FormState {
  return { nome: '', account_id: '', client_id: '', client_secret: '', workspace_host: '', warehouse_id: '', ativo: true }
}

function fromConfig(c: DatabricksConfig): FormState {
  return {
    nome: c.nome || '', account_id: c.account_id || '', client_id: c.client_id || '', client_secret: '',
    workspace_host: c.workspace_host || '', warehouse_id: c.warehouse_id || '', ativo: c.ativo,
  }
}

interface DatabricksConfigModalProps {
  config: DatabricksConfig | null
  onClose: () => void
}

// Fase 1 — só a configuração da conexão (credenciais OAuth M2M do Service Principal +
// endpoint SQL Warehouse). Porta de SPModal.tsx (Coleta Azure), sem os campos de
// agendamento (dia/hora_execucao, granularidade_dias) — esses só fazem sentido a partir
// da Fase 2, quando a coleta agendada de verdade existir.
export default function DatabricksConfigModal({ config, onClose }: DatabricksConfigModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (config ? fromConfig(config) : emptyForm()))

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
    if (!form.nome || !form.account_id || !form.client_id || !form.workspace_host || !form.warehouse_id) {
      window.showToast?.('Preencha Nome, Account ID, Client ID, Workspace Host e Warehouse ID.', 'error')
      return
    }
    if (!config && !form.client_secret) {
      window.showToast?.('Client Secret é obrigatório para uma configuração nova.', 'error')
      return
    }
    const input: DatabricksConfigInput = {
      nome: form.nome, account_id: form.account_id, client_id: form.client_id,
      workspace_host: form.workspace_host, warehouse_id: form.warehouse_id, ativo: form.ativo,
    }
    if (form.client_secret) input.client_secret = form.client_secret
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
              <label htmlFor="dbx-account-id">Account ID *</label>
              <input id="dbx-account-id" type="text" required placeholder="ID da conta Databricks (UUID)" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="dbx-client-id">Client ID *</label>
              <input id="dbx-client-id" type="text" required placeholder="Service Principal (OAuth M2M)" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="dbx-client-secret">Client Secret {config && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(deixe em branco pra manter o atual)</span>}</label>
              <input id="dbx-client-secret" type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
            </div>
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

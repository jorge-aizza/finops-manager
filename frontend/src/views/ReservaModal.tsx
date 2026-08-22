import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CmsSelect from '../components/CmsSelect'
import { createReserva, deleteReserva, updateReserva } from '../api/reservas'
import { listResourceGroups } from '../api/azure'
import { CLOUDS, DEFAULT_SCOPE, SCOPE_CONFIG, TIPOS_RECURSO, type Cloud } from '../config/reservaScopes'
import type { AzureSubscription, Reserva, ReservaInput } from '../types/reserva'

interface FormState {
  cloud: string
  nome_reserva: string
  tipo_escopo: string
  subValue: string
  subLabel: string
  rgValue: string
  rgLabel: string
  subManual: string
  rgManual: string
  tipo_recurso: string
  instancia: string
  quantidade: string
  prazo: string
  opcao_pagamento: string
  custo_total: string
  custo_mensal: string
  data_inicio: string
  data_vencimento: string
  status: string
  observacoes: string
}

const EMPTY_FORM: FormState = {
  cloud: '', nome_reserva: '', tipo_escopo: 'Shared',
  subValue: '', subLabel: '', rgValue: '', rgLabel: '', subManual: '', rgManual: '',
  tipo_recurso: '', instancia: '', quantidade: '1', prazo: '', opcao_pagamento: '',
  custo_total: '', custo_mensal: '', data_inicio: '', data_vencimento: '', status: 'Ativa',
  observacoes: '',
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Porta fiel de onRsvPrazoChange() (app.js): prazo "3 anos" → +3 anos,
// senão +1 ano, a partir de data_inicio (ou hoje se vazia). Sobrescreve
// sempre que prazo ou data_inicio mudam — sem checagem de "sujo".
function computeVencimento(prazo: string, dataInicio: string): string {
  if (!prazo) return ''
  const anos = prazo.startsWith('3') ? 3 : 1
  const base = dataInicio ? new Date(dataInicio + 'T00:00:00') : new Date()
  const venc = new Date(base)
  venc.setFullYear(venc.getFullYear() + anos)
  return isoDate(venc)
}

function fromReserva(r: Reserva, subscriptions: AzureSubscription[]): FormState {
  const cloud = r.cloud
  const escopo = r.tipo_escopo || 'Shared'
  const cfg = (SCOPE_CONFIG[cloud as Cloud] || {})[escopo] || {}
  const subFromApi = cfg.sub?.api
  const rgFromApi = cfg.rg?.api
  const subName = subFromApi
    ? subscriptions.find((s) => s.subscription_id === r.subscription_id)?.subscription_name || r.subscription_id || ''
    : ''
  return {
    cloud,
    nome_reserva: r.nome_reserva || '',
    tipo_escopo: escopo,
    subValue: subFromApi ? r.subscription_id || '' : '',
    subLabel: subFromApi ? subName : '',
    rgValue: rgFromApi ? r.resource_group_name || '' : '',
    rgLabel: rgFromApi ? r.resource_group_name || '' : '',
    subManual: !subFromApi ? r.subscription_id || '' : '',
    rgManual: !rgFromApi ? r.resource_group_name || '' : '',
    tipo_recurso: r.tipo_recurso || '',
    instancia: r.instancia || '',
    quantidade: String(r.quantidade ?? 1),
    prazo: r.prazo || '',
    opcao_pagamento: r.opcao_pagamento || '',
    custo_total: r.custo_total != null ? String(r.custo_total) : '',
    custo_mensal: r.custo_mensal != null ? String(r.custo_mensal) : '',
    data_inicio: r.data_inicio ? r.data_inicio.split('T')[0] : '',
    data_vencimento: r.data_vencimento ? r.data_vencimento.split('T')[0] : '',
    status: r.status || 'Ativa',
    observacoes: r.observacoes || '',
  }
}

interface ReservaModalProps {
  reserva: Reserva | null
  subscriptions: AzureSubscription[]
  onClose: () => void
}

export default function ReservaModal({ reserva, subscriptions, onClose }: ReservaModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() =>
    reserva ? fromReserva(reserva, subscriptions) : EMPTY_FORM,
  )

  const cloud = (form.cloud || null) as Cloud | null
  const scopeCfg = cloud ? (SCOPE_CONFIG[cloud]?.[form.tipo_escopo] ?? {}) : {}
  const escopoOptions = cloud ? Object.keys(SCOPE_CONFIG[cloud]) : []
  const tiposRecurso = cloud ? TIPOS_RECURSO[cloud] : []

  const rgQuery = useQuery({
    queryKey: ['azure-resource-groups', form.subValue],
    queryFn: () => listResourceGroups(form.subValue || undefined),
    enabled: cloud === 'Azure' && !!scopeCfg.rg?.api,
  })
  const rgOptions = (rgQuery.data || []).map((r) => ({ value: r.resource_group_name, label: r.resource_group_name }))
  const subOptions = subscriptions.map((s) => ({
    value: s.subscription_id,
    label: s.subscription_name || s.subscription_id,
  }))

  function handleCloudChange(newCloud: string) {
    const defaultEscopo = newCloud ? DEFAULT_SCOPE[newCloud as Cloud] : 'Shared'
    setForm((f) => ({
      ...f,
      cloud: newCloud,
      tipo_escopo: defaultEscopo,
      tipo_recurso: '',
      subValue: '', subLabel: '', rgValue: '', rgLabel: '', subManual: '', rgManual: '',
    }))
  }

  function handleEscopoChange(newEscopo: string) {
    setForm((f) => ({
      ...f,
      tipo_escopo: newEscopo,
      subValue: '', subLabel: '', rgValue: '', rgLabel: '', subManual: '', rgManual: '',
    }))
  }

  function handlePrazoOrInicioChange(patch: Partial<Pick<FormState, 'prazo' | 'data_inicio'>>) {
    setForm((f) => {
      const next = { ...f, ...patch }
      const venc = computeVencimento(next.prazo, next.data_inicio)
      return venc ? { ...next, data_vencimento: venc } : next
    })
  }

  const saveMutation = useMutation({
    mutationFn: (input: ReservaInput) =>
      reserva ? updateReserva(reserva.id, input) : createReserva(input),
    onSuccess: () => {
      window.showToast?.('Reserva salva com sucesso!', 'success')
      queryClient.invalidateQueries({ queryKey: ['reservas'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar reserva: ' + e.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteReserva(id),
    onSuccess: () => {
      window.showToast?.('Reserva excluída.', 'success')
      queryClient.invalidateQueries({ queryKey: ['reservas'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir reserva: ' + e.message, 'error'),
  })

  function handleDelete() {
    if (!reserva) return
    if (!confirm(`Excluir a reserva "${reserva.nome_reserva}"? Esta ação não pode ser desfeita.`)) return
    deleteMutation.mutate(reserva.id)
  }

  const showSub = !!scopeCfg.sub
  const showRg = !!scopeCfg.rg

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.cloud || !form.nome_reserva || !form.tipo_recurso || !form.data_vencimento) {
      window.showToast?.('Preencha Cloud, Nome, Tipo de Recurso e Vencimento.', 'error')
      return
    }
    const input: ReservaInput = {
      cloud: form.cloud,
      nome_reserva: form.nome_reserva,
      tipo_escopo: form.tipo_escopo,
      subscription_id: showSub ? (scopeCfg.sub?.api ? form.subValue || null : form.subManual.trim() || null) : null,
      resource_group_name: showRg ? (scopeCfg.rg?.api ? form.rgValue || null : form.rgManual.trim() || null) : null,
      tipo_recurso: form.tipo_recurso,
      instancia: form.instancia,
      quantidade: parseInt(form.quantidade, 10) || 1,
      prazo: form.prazo,
      opcao_pagamento: form.opcao_pagamento,
      custo_total: form.custo_total ? parseFloat(form.custo_total) : null,
      custo_mensal: form.custo_mensal ? parseFloat(form.custo_mensal) : null,
      data_inicio: form.data_inicio,
      data_vencimento: form.data_vencimento,
      status: form.status,
      observacoes: form.observacoes,
    }
    saveMutation.mutate(input)
  }

  const subFieldLabel = scopeCfg.sub?.label || 'Subscription'
  const rgFieldLabel = scopeCfg.rg?.label || 'Resource Group'

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span>{reserva ? 'Editar Reserva' : 'Nova Reserva'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form id="reserva-form" onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="rsv-cloud">Cloud *</label>
                <select
                  id="rsv-cloud"
                  required
                  value={form.cloud}
                  onChange={(e) => handleCloudChange(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {CLOUDS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="rsv-nome">Nome da Reserva *</label>
                <input
                  id="rsv-nome"
                  type="text"
                  placeholder="Ex: VM-Prod-Reserva-1ano"
                  value={form.nome_reserva}
                  onChange={(e) => setForm({ ...form, nome_reserva: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-escopo">Tipo de Escopo *</label>
                <select
                  id="rsv-escopo"
                  value={form.tipo_escopo}
                  onChange={(e) => handleEscopoChange(e.target.value)}
                  disabled={!cloud}
                >
                  {escopoOptions.length ? (
                    escopoOptions.map((o) => <option key={o}>{o}</option>)
                  ) : (
                    <option value="Shared">Shared</option>
                  )}
                </select>
              </div>

              {showSub && (
                <div className="form-group">
                  <label>{subFieldLabel}</label>
                  {scopeCfg.sub?.api ? (
                    <CmsSelect
                      value={form.subValue}
                      label={form.subLabel}
                      options={subOptions}
                      searchPlaceholder="Buscar subscription..."
                      onChange={(value, label) =>
                        setForm((f) => ({
                          ...f,
                          subValue: value, subLabel: label,
                          // Trocar a subscription reresseta o RG (que é escopado por ela)
                          rgValue: '', rgLabel: '',
                        }))
                      }
                      onClear={() => setForm((f) => ({ ...f, subValue: '', subLabel: '', rgValue: '', rgLabel: '' }))}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder={scopeCfg.sub?.placeholder}
                      value={form.subManual}
                      onChange={(e) => setForm({ ...form, subManual: e.target.value })}
                    />
                  )}
                </div>
              )}

              {showRg && (
                <div className="form-group">
                  <label>{rgFieldLabel}</label>
                  {scopeCfg.rg?.api ? (
                    <CmsSelect
                      value={form.rgValue}
                      label={form.rgLabel}
                      options={rgOptions}
                      loading={rgQuery.isLoading}
                      searchPlaceholder="Buscar resource group..."
                      onChange={(value, label) => setForm((f) => ({ ...f, rgValue: value, rgLabel: label }))}
                      onClear={() => setForm((f) => ({ ...f, rgValue: '', rgLabel: '' }))}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder={scopeCfg.rg?.placeholder}
                      value={form.rgManual}
                      onChange={(e) => setForm({ ...form, rgManual: e.target.value })}
                    />
                  )}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="rsv-tipo-recurso">Tipo de Recurso *</label>
                <select
                  id="rsv-tipo-recurso"
                  value={form.tipo_recurso}
                  onChange={(e) => setForm({ ...form, tipo_recurso: e.target.value })}
                  disabled={!cloud}
                >
                  <option value="">{cloud ? 'Selecione...' : 'Selecione a cloud primeiro'}</option>
                  {tiposRecurso.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="rsv-instancia">Instância / Tamanho</label>
                <input
                  id="rsv-instancia"
                  type="text"
                  placeholder="Ex: Standard_D4s_v3, m5.xlarge"
                  value={form.instancia}
                  onChange={(e) => setForm({ ...form, instancia: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-quantidade">Quantidade</label>
                <input
                  id="rsv-quantidade"
                  type="number"
                  min={1}
                  value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-prazo">Prazo</label>
                <select
                  id="rsv-prazo"
                  value={form.prazo}
                  onChange={(e) => handlePrazoOrInicioChange({ prazo: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  <option>1 ano</option>
                  <option>3 anos</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="rsv-pagamento">Opção de Pagamento</label>
                <select
                  id="rsv-pagamento"
                  value={form.opcao_pagamento}
                  onChange={(e) => setForm({ ...form, opcao_pagamento: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  <option>All Upfront</option>
                  <option>Partial Upfront</option>
                  <option>No Upfront</option>
                  <option>Monthly</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="rsv-custo-total">Custo Total (R$)</label>
                <input
                  id="rsv-custo-total"
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={form.custo_total}
                  onChange={(e) => setForm({ ...form, custo_total: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-custo-mensal">Custo Mensal (R$)</label>
                <input
                  id="rsv-custo-mensal"
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={form.custo_mensal}
                  onChange={(e) => setForm({ ...form, custo_mensal: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-data-inicio">Data de Início</label>
                <input
                  id="rsv-data-inicio"
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => handlePrazoOrInicioChange({ data_inicio: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-data-vencimento">Data de Vencimento *</label>
                <input
                  id="rsv-data-vencimento"
                  type="date"
                  required
                  value={form.data_vencimento}
                  onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="rsv-status">Status</label>
                <select
                  id="rsv-status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option>Ativa</option>
                  <option>Expirada</option>
                  <option>Cancelada</option>
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 4 }}>
              <label htmlFor="rsv-observacoes">Observações</label>
              <textarea
                id="rsv-observacoes"
                rows={2}
                placeholder="Notas adicionais..."
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </form>
        </div>
        <div className="modal-footer">
          {reserva && (
            <button
              className="btn-ghost"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)', marginRight: 'auto' }}
              onClick={handleDelete}
            >
              Excluir
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="reserva-form" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

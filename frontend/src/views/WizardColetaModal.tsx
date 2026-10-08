import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { coletarAPI, getColetaStatus, listarRGsSP, listarSubsSP, salvarAgendamentoSP } from '../api/coleta'
import CheckboxSearchList from '../components/CheckboxSearchList'
import type { MetricColeta, ModoColeta, ServicePrincipal } from '../types/coleta'

const DIAS_SEMANA = [
  { v: '1', label: 'Seg' }, { v: '2', label: 'Ter' }, { v: '3', label: 'Qua' }, { v: '4', label: 'Qui' },
  { v: '5', label: 'Sex' }, { v: '6', label: 'Sáb' }, { v: '0', label: 'Dom' },
]

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function presetPeriodo(preset: 'mes_atual' | 'mes_anterior' | 'trimestre'): { inicio: string; fim: string } {
  const hoje = new Date()
  if (preset === 'mes_atual') {
    return { inicio: ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: ymd(hoje) }
  }
  if (preset === 'mes_anterior') {
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
    return { inicio: ymd(new Date(fim.getFullYear(), fim.getMonth(), 1)), fim: ymd(fim) }
  }
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1)
  return { inicio: ymd(inicio), fim: ymd(hoje) }
}

interface Props {
  sp: ServicePrincipal
  onClose: () => void
}

// Porta do wizard #modal-wizard-coleta (4 passos: Assinaturas → Resource
// Groups → Período → Confirmar+Agendamento) — app.js:5206-5764. Modo
// billing_profile pode pular direto pro período (sem seleção de sub/RG),
// já que a coleta roda pelo billing account/profile configurado na SP.
export default function WizardColetaModal({ sp, onClose }: Props) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [scope, setScope] = useState<'subscriptions' | 'billing_profile'>(sp.modo_coleta === 'billing_profile' ? 'billing_profile' : 'subscriptions')

  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(new Set())
  const [selectedRGs, setSelectedRGs] = useState<Set<string>>(new Set())

  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [metric, setMetric] = useState<MetricColeta>('ActualCost')

  const [schedAtivo, setSchedAtivo] = useState(sp.auto_coleta)
  const [schedHora, setSchedHora] = useState(sp.hora_execucao ?? 6)
  const [schedMinuto, setSchedMinuto] = useState(0)
  const [schedDiasEspecificos, setSchedDiasEspecificos] = useState((sp.dias_semana || '').length > 0)
  const [schedDias, setSchedDias] = useState<Set<string>>(new Set((sp.dias_semana || '1,2,3,4,5').split(',').filter(Boolean)))

  const skipSubStep = scope === 'billing_profile'

  const subsQuery = useQuery({
    queryKey: ['wizard-subs', sp.id],
    queryFn: () => listarSubsSP(sp.id),
    enabled: step === 1 && !skipSubStep,
  })
  const subItems = (subsQuery.data?.subs || []).map((s) => ({ id: s.subscriptionId, label: s.nome }))

  const rgsQuery = useQuery({
    queryKey: ['wizard-rgs', sp.id, [...selectedSubs].sort()],
    queryFn: () => listarRGsSP(sp.id, [...selectedSubs]),
    enabled: step === 2 && selectedSubs.size > 0,
  })
  // Dedup por nome de RG — o corpo de coletar-api aceita só nomes (não pares
  // sub+RG); um RG com o mesmo nome em subs diferentes vira uma única entrada.
  const rgItems = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const r of rgsQuery.data?.rgs || []) {
      if (!seen.has(r.name)) seen.set(r.name, [])
      seen.get(r.name)!.push(r.subscriptionId)
    }
    return [...seen.entries()]
      .map(([name, subs]) => ({ id: name, label: name, sublabel: subs.length > 1 ? `${subs.length} assinaturas` : undefined }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rgsQuery.data])

  function toggleSub(id: string, checked: boolean) {
    setSelectedSubs((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n })
  }
  function toggleRG(id: string, checked: boolean) {
    setSelectedRGs((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n })
  }
  function toggleDia(v: string, checked: boolean) {
    setSchedDias((prev) => { const n = new Set(prev); if (checked) n.add(v); else n.delete(v); return n })
  }

  function goStep1to2() {
    if (skipSubStep) { setStep(3); return }
    if (!selectedSubs.size) { window.showToast?.('Selecione ao menos uma assinatura.', 'error'); return }
    setSelectedRGs(new Set())
    setStep(2)
  }
  function goStep2to3() { setStep(3) }
  function goStep3to4() {
    if (!inicio || !fim) { window.showToast?.('Informe o período.', 'error'); return }
    if (fim < inicio) { window.showToast?.('Data fim deve ser posterior à data início.', 'error'); return }
    setStep(4)
  }

  useEffect(() => {
    if (step === 3 && !inicio && !fim) {
      const p = presetPeriodo('mes_atual')
      setInicio(p.inicio); setFim(p.fim)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const statusQuery = useQuery({ queryKey: ['coleta-status'], queryFn: getColetaStatus, enabled: false })

  const agendamentoMutation = useMutation({
    mutationFn: () => {
      const diasParaEnviar = !schedDiasEspecificos ? '0,1,2,3,4,5,6' : [...schedDias].join(',')
      return salvarAgendamentoSP(sp.id, {
        hora_execucao: schedAtivo ? schedHora : null,
        dias_semana: schedAtivo ? diasParaEnviar : null,
        auto_coleta: schedAtivo,
      })
    },
  })

  const coletarMutation = useMutation({
    mutationFn: async () => {
      const fresh = await statusQuery.refetch()
      const apiExecAtiva = fresh.data?.execucoes?.some((e) => e.tipo === 'api' && e.id === sp.id && e.status === null)
      if (apiExecAtiva) throw new Error('Esta Service Principal já está coletando dados.')
      if (schedAtivo || sp.auto_coleta) await agendamentoMutation.mutateAsync()
      return coletarAPI(sp.id, {
        modo: (skipSubStep ? 'billing_profile' : 'subscription') as ModoColeta,
        data_inicio: inicio,
        data_fim: fim,
        metric,
        billing_account_id: skipSubStep ? sp.billing_account_id || undefined : undefined,
        billing_profile_id: skipSubStep ? sp.billing_profile_id || undefined : undefined,
        subscription_ids: skipSubStep ? undefined : [...selectedSubs],
        resource_groups: skipSubStep ? undefined : [...selectedRGs],
      })
    },
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-sps'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao iniciar coleta: ' + e.message, 'error'),
  })

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <span>Nova Coleta via API — {sp.nome}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: n <= step ? 'var(--accent)' : 'var(--border)',
              }} />
            ))}
          </div>

          {sp.modo_coleta === 'billing_profile' && step === 1 && (
            <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.06)', borderRadius: 7, padding: 2, marginBottom: 14 }}>
              <button onClick={() => setScope('billing_profile')} style={{ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', background: scope === 'billing_profile' ? 'var(--accent)' : 'transparent', color: scope === 'billing_profile' ? '#fff' : 'var(--text-muted)' }}>Billing Profile (todas as subs)</button>
              <button onClick={() => setScope('subscriptions')} style={{ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', background: scope === 'subscriptions' ? 'var(--accent)' : 'transparent', color: scope === 'subscriptions' ? '#fff' : 'var(--text-muted)' }}>Assinaturas específicas</button>
            </div>
          )}

          {step === 1 && !skipSubStep && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>1. Selecione as assinaturas</div>
              <CheckboxSearchList
                items={subItems} selected={selectedSubs} onToggle={toggleSub}
                onSelectAll={(c) => setSelectedSubs(c ? new Set(subItems.map((i) => i.id)) : new Set())}
                loading={subsQuery.isLoading} emptyText="Nenhuma assinatura encontrada."
              />
            </>
          )}
          {step === 1 && skipSubStep && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0' }}>
              Escopo "Billing Profile" selecionado — a coleta busca todas as assinaturas do Billing Account/Profile
              configurado nesta SP. Clique em Avançar pra definir o período.
            </div>
          )}

          {step === 2 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>2. Resource Groups (opcional — vazio = todos)</div>
              <CheckboxSearchList
                items={rgItems} selected={selectedRGs} onToggle={toggleRG}
                onSelectAll={(c) => setSelectedRGs(c ? new Set(rgItems.map((i) => i.id)) : new Set())}
                loading={rgsQuery.isLoading} emptyText="Nenhum Resource Group encontrado."
              />
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>3. Período</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {(['mes_atual', 'mes_anterior', 'trimestre'] as const).map((p) => (
                  <button key={p} type="button" className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={() => { const r = presetPeriodo(p); setInicio(r.inicio); setFim(r.fim) }}>
                    {p === 'mes_atual' ? 'Mês atual' : p === 'mes_anterior' ? 'Mês anterior' : 'Últimos 3 meses'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
                <input type="date" className="ci" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <input type="date" className="ci" value={fim} onChange={(e) => setFim(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Tipo de Custo</label>
                <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="wizard-metric" checked={metric === 'ActualCost'} onChange={() => setMetric('ActualCost')} style={{ width: 'auto', flexShrink: 0 }} />
                    Actual Cost
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="wizard-metric" checked={metric === 'AmortizedCost'} onChange={() => setMetric('AmortizedCost')} style={{ width: 'auto', flexShrink: 0 }} />
                    Amortized Cost
                  </label>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>4. Confirmar</div>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 12, marginBottom: 16 }}>
                <div><strong>Escopo:</strong> {skipSubStep ? 'Billing Profile (todas as assinaturas)' : `${selectedSubs.size} assinatura(s)${selectedRGs.size ? `, ${selectedRGs.size} RG(s)` : ', todos os RGs'}`}</div>
                <div><strong>Período:</strong> {inicio} → {fim}</div>
                <div><strong>Métrica:</strong> {metric}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <input type="checkbox" checked={schedAtivo} onChange={(e) => setSchedAtivo(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Agendar execução recorrente com este mesmo escopo</span>
              </div>
              {schedAtivo && (
                <div style={{ paddingLeft: 24 }}>
                  {/* Horário completo com badge Dia/Noite */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>Horário:</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="number" min={0} max={23} className="ci" style={{ width: 70, height: 36, textAlign: 'center', fontSize: 16, fontWeight: 600 }} value={String(schedHora).padStart(2, '0')}
                          onChange={(e) => setSchedHora(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))} />
                        <span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 700 }}>:</span>
                        <input type="number" min={0} max={59} className="ci" style={{ width: 70, height: 36, textAlign: 'center', fontSize: 16, fontWeight: 600 }} value={String(schedMinuto).padStart(2, '0')}
                          onChange={(e) => setSchedMinuto(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))} />
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        background: schedHora >= 6 && schedHora < 18 ? 'rgba(255, 193, 7, 0.2)' : 'rgba(63, 81, 181, 0.2)',
                        color: schedHora >= 6 && schedHora < 18 ? '#ff9800' : '#3f51b5',
                      }}>
                        {schedHora >= 6 && schedHora < 18 ? '☀ Dia' : '🌙 Noite'}
                      </span>
                    </div>
                  </div>

                  {/* Seleção de dias: Todos os dias ou dias específicos */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 8 }}>
                      <input type="radio" checked={!schedDiasEspecificos} onChange={() => {
                        setSchedDiasEspecificos(false)
                        setSchedDias(new Set())
                      }} style={{ width: 'auto', flexShrink: 0 }} />
                      <span style={{ fontWeight: schedDiasEspecificos ? 400 : 700 }}>A cada 1 dia (todos os dias)</span>
                    </label>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" checked={schedDiasEspecificos} onChange={() => setSchedDiasEspecificos(true)} style={{ width: 'auto', flexShrink: 0 }} />
                      <span style={{ fontWeight: schedDiasEspecificos ? 700 : 400 }}>Dias específicos da semana</span>
                    </label>
                  </div>

                  {/* Checkboxes de dias específicos */}
                  {schedDiasEspecificos && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 24 }}>
                      {DIAS_SEMANA.map((d) => (
                        <label key={d.v} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                          <input type="checkbox" checked={schedDias.has(d.v)} onChange={(e) => toggleDia(d.v, e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
                          {d.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {step > 1 && <button className="btn-ghost" onClick={() => setStep(step === 2 && skipSubStep ? 1 : step - 1)}>Voltar</button>}
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          {step === 1 && <button className="btn-primary" onClick={goStep1to2}>Avançar</button>}
          {step === 2 && <button className="btn-primary" onClick={goStep2to3}>Avançar</button>}
          {step === 3 && <button className="btn-primary" onClick={goStep3to4}>Avançar</button>}
          {step === 4 && (
            <button className="btn-primary" disabled={coletarMutation.isPending} onClick={() => coletarMutation.mutate()}>
              {coletarMutation.isPending ? 'Iniciando...' : '▶ Iniciar Coleta'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

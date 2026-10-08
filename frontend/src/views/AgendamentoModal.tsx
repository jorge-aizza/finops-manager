import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { coletarAPI, excluirAgendamentoSP, getColetaStatus, salvarAgendamentoSP } from '../api/coleta'
import type { ModoColeta, ServicePrincipal } from '../types/coleta'

const DIAS_SEMANA = [
  { v: '1', label: 'Seg' }, { v: '2', label: 'Ter' }, { v: '3', label: 'Qua' }, { v: '4', label: 'Qui' },
  { v: '5', label: 'Sex' }, { v: '6', label: 'Sáb' }, { v: '0', label: 'Dom' },
]

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  sp: ServicePrincipal
  onClose: () => void
}

// Porta simplificada de #modal-editar-agend (app.js:4126+) — edita o
// agendamento recorrente de uma SP e oferece "Coletar agora" com uma janela
// rolante (hoje − granularidade_dias). O picker de assinaturas ao vivo do
// legado (agendBuscarSubs/_agendRenderSubs) não foi portado aqui de
// propósito — mudar o ESCOPO de assinaturas/RGs é feito pelo wizard
// ("Iniciar Coleta"), que já cobre isso; duplicar o picker aqui só
// fragmentaria onde o escopo é editado.
export default function AgendamentoModal({ sp, onClose }: Props) {
  const queryClient = useQueryClient()
  const [ativo, setAtivo] = useState(sp.auto_coleta)
  const [hora, setHora] = useState(sp.hora_execucao ?? 6)
  const [minuto, setMinuto] = useState(0)
  const [diasEspecificos, setDiasEspecificos] = useState((sp.dias_semana || '').length > 0)
  const [dias, setDias] = useState<Set<string>>(new Set((sp.dias_semana || '1,2,3,4,5').split(',').filter(Boolean)))

  const subscriptionIds = (sp.subscription_ids || '').split(',').map((s) => s.trim()).filter(Boolean)

  function toggleDia(v: string, checked: boolean) {
    setDias((prev) => { const n = new Set(prev); if (checked) n.add(v); else n.delete(v); return n })
  }

  const salvarMutation = useMutation({
    mutationFn: () => {
      const diasParaEnviar = !diasEspecificos ? '0,1,2,3,4,5,6' : [...dias].join(',')
      return salvarAgendamentoSP(sp.id, {
        hora_execucao: ativo ? hora : null,
        dias_semana: ativo ? diasParaEnviar : null,
        auto_coleta: ativo,
      })
    },
    onSuccess: () => {
      window.showToast?.('Agendamento salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-sps'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar agendamento: ' + e.message, 'error'),
  })

  const excluirMutation = useMutation({
    mutationFn: () => excluirAgendamentoSP(sp.id),
    onSuccess: () => {
      window.showToast?.('Agendamento removido.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-sps'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao remover agendamento: ' + e.message, 'error'),
  })

  const statusQuery = useQuery({ queryKey: ['coleta-status'], queryFn: getColetaStatus, enabled: false })

  const coletarAgoraMutation = useMutation({
    mutationFn: async () => {
      const fresh = await statusQuery.refetch()
      const apiExecAtiva = fresh.data?.execucoes?.some((e) => e.tipo === 'api' && e.id === sp.id && e.status === null)
      if (apiExecAtiva) throw new Error('Esta Service Principal já está coletando dados.')
      const fim = new Date()
      const ini = new Date(fim)
      ini.setDate(ini.getDate() - (sp.granularidade_dias || 7))
      return coletarAPI(sp.id, {
        modo: sp.modo_coleta as ModoColeta,
        data_inicio: ymd(ini),
        data_fim: ymd(fim),
        metric: 'ActualCost',
        billing_account_id: sp.modo_coleta === 'billing_profile' ? sp.billing_account_id || undefined : undefined,
        billing_profile_id: sp.modo_coleta === 'billing_profile' ? sp.billing_profile_id || undefined : undefined,
        subscription_ids: sp.modo_coleta === 'subscription' ? subscriptionIds : undefined,
      })
    },
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao coletar: ' + e.message, 'error'),
  })

  const podeColetarAgora = sp.modo_coleta === 'billing_profile'
    ? !!(sp.billing_account_id && sp.billing_profile_id)
    : subscriptionIds.length > 0

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>Agendamento — {sp.nome}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            {sp.modo_coleta === 'billing_profile'
              ? 'Escopo: Billing Profile (todas as assinaturas do billing account configurado).'
              : subscriptionIds.length
                ? `Escopo: ${subscriptionIds.length} assinatura(s) já salva(s) nesta SP.`
                : 'Nenhuma assinatura salva ainda — use "Iniciar Coleta" pra selecionar o escopo primeiro.'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Coleta automática recorrente</span>
          </div>
          {ativo && (
            <div style={{ paddingLeft: 24, marginBottom: 16 }}>
              {/* Horário completo com badge Dia/Noite */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>Horário:</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="number" min={0} max={23} className="ci" style={{ width: 70, height: 36, textAlign: 'center', fontSize: 16, fontWeight: 600 }} value={String(hora).padStart(2, '0')}
                      onChange={(e) => setHora(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))} />
                    <span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 700 }}>:</span>
                    <input type="number" min={0} max={59} className="ci" style={{ width: 70, height: 36, textAlign: 'center', fontSize: 16, fontWeight: 600 }} value={String(minuto).padStart(2, '0')}
                      onChange={(e) => setMinuto(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))} />
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: hora >= 6 && hora < 18 ? 'rgba(255, 193, 7, 0.2)' : 'rgba(63, 81, 181, 0.2)',
                    color: hora >= 6 && hora < 18 ? '#ff9800' : '#3f51b5',
                  }}>
                    {hora >= 6 && hora < 18 ? '☀ Dia' : '🌙 Noite'}
                  </span>
                </div>
              </div>

              {/* Seleção de dias: Todos os dias ou dias específicos */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="radio" checked={!diasEspecificos} onChange={() => {
                    setDiasEspecificos(false)
                    setDias(new Set())
                  }} style={{ width: 'auto', flexShrink: 0 }} />
                  <span style={{ fontWeight: diasEspecificos ? 400 : 700 }}>A cada 1 dia (todos os dias)</span>
                </label>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" checked={diasEspecificos} onChange={() => setDiasEspecificos(true)} style={{ width: 'auto', flexShrink: 0 }} />
                  <span style={{ fontWeight: diasEspecificos ? 700 : 400 }}>Dias específicos da semana</span>
                </label>
              </div>

              {/* Checkboxes de dias específicos */}
              {diasEspecificos && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 24 }}>
                  {DIAS_SEMANA.map((d) => (
                    <label key={d.v} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                      <input type="checkbox" checked={dias.has(d.v)} onChange={(e) => toggleDia(d.v, e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
                      {d.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <button className="btn-ghost" disabled={!podeColetarAgora || coletarAgoraMutation.isPending} onClick={() => coletarAgoraMutation.mutate()}
              title={podeColetarAgora ? `Coleta os últimos ${sp.granularidade_dias || 7} dias` : 'Configure o escopo primeiro'}>
              {coletarAgoraMutation.isPending ? 'Iniciando...' : `▶ Coletar agora (últimos ${sp.granularidade_dias || 7} dias)`}
            </button>
          </div>
        </div>
        <div className="modal-footer">
          {sp.auto_coleta && (
            <button className="btn-ghost" style={{ color: 'var(--danger)' }} disabled={excluirMutation.isPending} onClick={() => excluirMutation.mutate()}>
              Remover agendamento
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={salvarMutation.isPending} onClick={() => salvarMutation.mutate()}>
            {salvarMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

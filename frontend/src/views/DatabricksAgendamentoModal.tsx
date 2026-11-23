import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { coletarDatabricks, excluirAgendamentoDatabricks, salvarAgendamentoDatabricks } from '../api/databricksColeta'
import type { DatabricksConfig } from '../types/databricksColeta'

const DIAS_SEMANA = [
  { v: '1', label: 'Seg' }, { v: '2', label: 'Ter' }, { v: '3', label: 'Qua' }, { v: '4', label: 'Qui' },
  { v: '5', label: 'Sex' }, { v: '6', label: 'Sáb' }, { v: '0', label: 'Dom' },
]

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function periodoManualPadrao() {
  const fim = new Date()
  fim.setDate(fim.getDate() - 1)
  const inicio = new Date(fim)
  inicio.setDate(inicio.getDate() - 89)
  return { inicio: ymd(inicio), fim: ymd(fim) }
}

interface Props {
  config: DatabricksConfig
  onClose: () => void
}

// Porta de AgendamentoModal.tsx (Coleta Azure) — sem o picker de assinaturas (a Coleta
// Databricks, Fase 2, coleta as System Tables inteiras via account_id, sem escopo por
// subscription/RG pra selecionar).
export default function DatabricksAgendamentoModal({ config, onClose }: Props) {
  const queryClient = useQueryClient()
  const [ativo, setAtivo] = useState(config.auto_coleta)
  const [hora, setHora] = useState(config.hora_execucao ?? 6)
  const [minuto, setMinuto] = useState(0)
  const [diasEspecificos, setDiasEspecificos] = useState((config.dias_semana || '').length > 0)
  const [dias, setDias] = useState<Set<string>>(new Set((config.dias_semana || '1,2,3,4,5').split(',').filter(Boolean)))
  const [granularidade, setGranularidade] = useState(config.granularidade_dias || 7)
  const [granularidadeAuxiliar, setGranularidadeAuxiliar] = useState(config.granularidade_auxiliar_dias || 1)
  const [incluirAuxiliares, setIncluirAuxiliares] = useState(true)
  const [periodoManual, setPeriodoManual] = useState(periodoManualPadrao)

  function toggleDia(v: string, checked: boolean) {
    setDias((prev) => { const n = new Set(prev); if (checked) n.add(v); else n.delete(v); return n })
  }

  const salvarMutation = useMutation({
    mutationFn: () => {
      const diasParaEnviar = !diasEspecificos ? '0,1,2,3,4,5,6' : [...dias].join(',')
      return salvarAgendamentoDatabricks(config.id, {
        hora_execucao: ativo ? hora : null,
        dias_semana: ativo ? diasParaEnviar : null,
        auto_coleta: ativo,
        granularidade_dias: granularidade,
        granularidade_auxiliar_dias: granularidadeAuxiliar,
      })
    },
    onSuccess: () => {
      window.showToast?.('Agendamento salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar agendamento: ' + e.message, 'error'),
  })

  const excluirMutation = useMutation({
    mutationFn: () => excluirAgendamentoDatabricks(config.id),
    onSuccess: () => {
      window.showToast?.('Agendamento removido.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-config'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao remover agendamento: ' + e.message, 'error'),
  })

  const coletarAgoraMutation = useMutation({
    mutationFn: () => coletarDatabricks(config.id, periodoManual.inicio, periodoManual.fim, incluirAuxiliares),
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-status'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao coletar: ' + e.message, 'error'),
  })

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>Agendamento — {config.nome}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
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
                    setGranularidade(1)
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

          <div className="form-group">
            <label htmlFor="dbx-gran">Granularidade (dias por coleta)</label>
            <input id="dbx-gran" type="number" min={1} value={granularidade}
              onChange={(e) => setGranularidade(Math.max(1, parseInt(e.target.value, 10) || 7))} />
          </div>
          <div className="form-group">
            <label htmlFor="dbx-gran-aux">Consultas auxiliares a cada (dias)</label>
            <input id="dbx-gran-aux" type="number" min={1} max={30} value={granularidadeAuxiliar}
              onChange={(e) => setGranularidadeAuxiliar(Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)))} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Billing continua na frequência principal. Padrão 1 dia preserva a coleta atual.</span>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div className="form-group" style={{ margin: 0, flex: '1 1 150px' }}>
                <label htmlFor="dbx-manual-inicio">Início da carga manual</label>
                <input id="dbx-manual-inicio" type="date" value={periodoManual.inicio}
                  max={periodoManual.fim} onChange={(e) => setPeriodoManual((p) => ({ ...p, inicio: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0, flex: '1 1 150px' }}>
                <label htmlFor="dbx-manual-fim">Fim da carga manual</label>
                <input id="dbx-manual-fim" type="date" value={periodoManual.fim}
                  min={periodoManual.inicio} max={ymd(new Date())}
                  onChange={(e) => setPeriodoManual((p) => ({ ...p, fim: e.target.value }))} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12 }}>
              <input type="checkbox" checked={incluirAuxiliares} onChange={(e) => setIncluirAuxiliares(e.target.checked)} style={{ width: 'auto' }} />
              Incluir consultas auxiliares nesta carga manual
            </label>
            <button className="btn-ghost" disabled={coletarAgoraMutation.isPending || !periodoManual.inicio || !periodoManual.fim || periodoManual.inicio > periodoManual.fim} onClick={() => coletarAgoraMutation.mutate()}>
              {coletarAgoraMutation.isPending ? 'Iniciando...' : `▶ Coletar ${periodoManual.inicio} → ${periodoManual.fim}`}
            </button>
          </div>
        </div>
        <div className="modal-footer">
          {config.auto_coleta && (
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

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { excluirAgendamentoStorage, salvarAgendamentoStorage } from '../api/coleta'
import type { StorageConfig } from '../types/coleta'

const DIAS_SEMANA = [
  { v: '1', label: 'Seg' }, { v: '2', label: 'Ter' }, { v: '3', label: 'Qua' }, { v: '4', label: 'Qui' },
  { v: '5', label: 'Sex' }, { v: '6', label: 'Sab' }, { v: '0', label: 'Dom' },
]

interface Props {
  storage: StorageConfig
  onClose: () => void
}

function isTodosOsDias(dias: string | null | undefined): boolean {
  if (!dias) return false
  const sorted = dias.split(',').map((d) => d.trim()).filter(Boolean).sort().join(',')
  return sorted === '0,1,2,3,4,5,6'
}

export default function StorageAgendamentoModal({ storage, onClose }: Props) {
  const queryClient = useQueryClient()
  const ativoInicial = storage.hora_execucao != null && !!storage.dias_semana
  const [ativo, setAtivo] = useState(ativoInicial)
  const [hora, setHora] = useState(storage.hora_execucao ?? 6)
  const [minuto, setMinuto] = useState(0)
  const [diasEspecificos, setDiasEspecificos] = useState(ativoInicial ? !isTodosOsDias(storage.dias_semana) : false)
  const [dias, setDias] = useState<Set<string>>(
    new Set((storage.dias_semana || '1,2,3,4,5').split(',').map((d) => d.trim()).filter(Boolean)),
  )

  function toggleDia(v: string, checked: boolean) {
    setDias((prev) => {
      const next = new Set(prev)
      if (checked) next.add(v)
      else next.delete(v)
      return next
    })
  }

  const salvarMutation = useMutation({
    mutationFn: () => {
      if (!ativo) return excluirAgendamentoStorage(storage.id)
      const diasParaEnviar = !diasEspecificos ? '0,1,2,3,4,5,6' : [...dias].join(',')
      if (!diasParaEnviar) throw new Error('Selecione ao menos um dia da semana')
      return salvarAgendamentoStorage(storage.id, {
        hora_execucao: hora,
        dias_semana: diasParaEnviar,
      })
    },
    onSuccess: () => {
      window.showToast?.('Agendamento do Storage salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-storages'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar agendamento: ' + e.message, 'error'),
  })

  const removerMutation = useMutation({
    mutationFn: () => excluirAgendamentoStorage(storage.id),
    onSuccess: () => {
      window.showToast?.('Agendamento removido.', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-storages'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao remover agendamento: ' + e.message, 'error'),
  })

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>Agendamento Storage - {storage.nome}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Coleta recorrente via Storage</span>
          </div>

          {ativo && (
            <div style={{ paddingLeft: 24, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>Horario:</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      className="ci"
                      style={{ width: 70, height: 36, textAlign: 'center', fontSize: 16, fontWeight: 600 }}
                      value={String(hora).padStart(2, '0')}
                      onChange={(e) => setHora(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))}
                    />
                    <span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 700 }}>:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      className="ci"
                      style={{ width: 70, height: 36, textAlign: 'center', fontSize: 16, fontWeight: 600 }}
                      value={String(minuto).padStart(2, '0')}
                      onChange={(e) => setMinuto(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                    />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="radio"
                    checked={!diasEspecificos}
                    onChange={() => {
                      setDiasEspecificos(false)
                      setDias(new Set())
                    }}
                    style={{ width: 'auto', flexShrink: 0 }}
                  />
                  <span style={{ fontWeight: diasEspecificos ? 400 : 700 }}>Todos os dias</span>
                </label>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    checked={diasEspecificos}
                    onChange={() => setDiasEspecificos(true)}
                    style={{ width: 'auto', flexShrink: 0 }}
                  />
                  <span style={{ fontWeight: diasEspecificos ? 700 : 400 }}>Dias especificos da semana</span>
                </label>
              </div>

              {diasEspecificos && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 24 }}>
                  {DIAS_SEMANA.map((d) => (
                    <label key={d.v} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={dias.has(d.v)}
                        onChange={(e) => toggleDia(d.v, e.target.checked)}
                        style={{ width: 'auto', flexShrink: 0 }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {!!storage.proxima_coleta && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Proxima coleta prevista: {new Date(storage.proxima_coleta).toLocaleString('pt-BR')}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {ativoInicial && (
            <button
              className="btn-ghost"
              style={{ color: 'var(--danger)' }}
              disabled={removerMutation.isPending}
              onClick={() => removerMutation.mutate()}
            >
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

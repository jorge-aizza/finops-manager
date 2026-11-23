import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reprocessarStorageMes, testarStorage } from '../api/coleta'

interface Props {
  storageId: number
  storageNome: string
  onClose: () => void
}

function mesAtual(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

export default function StorageReprocessModal({ storageId, storageNome, onClose }: Props) {
  const queryClient = useQueryClient()
  const [mes, setMes] = useState(mesAtual)
  const [resultado, setResultado] = useState<string | null>(null)
  const [snapshotValido, setSnapshotValido] = useState(false)
  const [runId, setRunId] = useState('')

  const mesValido = useMemo(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(mes), [mes])

  const validarMutation = useMutation({
    mutationFn: () => testarStorage(storageId, mes),
    onSuccess: (r) => {
      if (!r.periodoConfiguravel) {
        setSnapshotValido(false)
        setRunId('')
        setResultado(`O prefixo configurado nao contem {periodo}. Prefixo testado: ${r.prefix || '(raiz)'}.`)
        return
      }
      const ok = !!(r.total > 0 && (r.manifestRows || 0) > 0 && r.runId)
      setSnapshotValido(ok)
      setRunId(r.runId || '')
      const exemplos = (r.preview || []).slice(0, 3).map((b) => b.name).join(' · ')
      setResultado(
        `${ok ? 'Snapshot valido.' : 'Snapshot sem dados validos.'} ` +
        `Run ${r.runId || 'nao identificado'} · ${r.manifestRows ?? '—'} linha(s) · ${r.total} particao(oes) · ${r.totalSizeMB} MB` +
        `${r.prefix ? ` · ${r.prefix}` : ''}` +
        `${exemplos ? ` · ${exemplos}` : ''}`,
      )
    },
    onError: (e: Error) => {
      setSnapshotValido(false)
      setRunId('')
      setResultado('Falha ao validar: ' + e.message)
    },
  })

  const executarMutation = useMutation({
    mutationFn: () => reprocessarStorageMes(storageId, mes, runId),
    onSuccess: (r) => {
      window.showToast?.(r.message || `Reprocessamento de ${mes} iniciado.`, 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-status'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao reprocessar mes: ' + e.message, 'error'),
  })

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>Reprocessar mes - {storageNome}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label htmlFor="storage-reprocess-mes">Mes para reprocessar</label>
            <input
              id="storage-reprocess-mes"
              type="month"
              value={mes}
              onChange={(e) => {
                setMes(e.target.value)
                setSnapshotValido(false)
                setRunId('')
                setResultado(null)
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn-ghost" disabled={!mesValido || validarMutation.isPending} onClick={() => validarMutation.mutate()}>
              {validarMutation.isPending ? 'Validando...' : 'Testar snapshot do mes'}
            </button>
            <button
              className="btn-primary"
              disabled={!snapshotValido || executarMutation.isPending}
              onClick={() => {
                if (!confirm(`Aplicar o snapshot ${runId} de ${mes}?`)) return
                executarMutation.mutate()
              }}
            >
              {executarMutation.isPending ? 'Iniciando...' : 'Reprocessar mes'}
            </button>
          </div>

          {resultado && (
            <div style={{ fontSize: 12, color: snapshotValido ? 'var(--green)' : 'var(--danger)' }}>
              {resultado}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

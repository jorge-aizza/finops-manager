import { useQuery } from '@tanstack/react-query'
import { getLogAnalyticsConsumoDiario } from '../api/logAnalytics'
import CkBarChart from './CkBarChart'
import type { CkSerie } from './CkBarChart'

// Gráfico de detalhe "GB dia a dia + valor" de um workspace (2026-10-xx, pedido do usuário) —
// aberto pelo ícone 📊 na tabela de Workspaces de LogAnalyticsView. Mesmo padrão de modal do
// resto do app (InvoiceModal.tsx): createPortal + classes .modal-overlay/.modal, não o
// ck-modal-box do subsistema Databricks Cotas (esta tela não usa aquele visual).

const fmtGbEixo = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB'
const fmtBrlEixo = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

interface Props {
  workspaceGuid: string
  workspaceNomeFallback: string
  mes: string
  mesLabel: string
  onClose: () => void
}

export default function LogAnalyticsConsumoModal({ workspaceGuid, workspaceNomeFallback, mes, mesLabel, onClose }: Props) {
  const q = useQuery({
    queryKey: ['log-analytics-consumo-diario', workspaceGuid, mes],
    queryFn: () => getLogAnalyticsConsumoDiario(workspaceGuid, mes),
  })

  const pontos = q.data?.pontos || []
  const dias = pontos.map((p) => p.dia)
  const series: CkSerie[] = [
    { label: 'GB ingeridos', cor: '#7B2FBE', valores: pontos.map((p) => p.gb), eixo: 'a', fmt: fmtGbEixo },
    { label: 'Custo (R$)', cor: '#22c55e', valores: pontos.map((p) => p.custo), eixo: 'b', fmt: fmtBrlEixo },
  ]
  // dia de pico de ingestão — mesmo critério usado nos outros gráficos do app (maior barra vira destaque)
  const picoIndice = pontos.length
    ? pontos.reduce((best, p, i, arr) => (p.gb > arr[best].gb ? i : best), 0)
    : undefined

  const totalGb = pontos.reduce((a, p) => a + p.gb, 0)
  const totalCusto = pontos.reduce((a, p) => a + p.custo, 0)

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: 1000 }}>
        <div className="modal-header">
          <span>📊 Consumo diário — {q.data?.workspace_nome || workspaceNomeFallback} ({mesLabel})</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {q.isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
          {q.isError && <div style={{ fontSize: 12, color: 'var(--red,#ff4d6a)' }}>Erro ao carregar consumo diário.</div>}
          {q.data && pontos.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem dados de ingestão nesse período.</div>
          )}
          {pontos.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>Total do período: <strong style={{ color: 'var(--text)' }}>{fmtGbEixo(totalGb)}</strong></span>
                <span>Custo total: <strong style={{ color: 'var(--text)' }}>{fmtBrlEixo(totalCusto)}</strong></span>
                <span>Média: <strong style={{ color: 'var(--text)' }}>{fmtGbEixo(totalGb / pontos.length)}/dia</strong></span>
              </div>
              <CkBarChart dias={dias} series={series} destaqueIndice={picoIndice} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

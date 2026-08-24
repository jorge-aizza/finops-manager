import { useQuery } from '@tanstack/react-query'
import { getDiagAgendador } from '../api/coleta'

interface Props {
  onClose: () => void
}

// Porta de diagAgendador() (app.js:4356) — dump de diagnóstico read-only:
// por que uma SP/Storage "deveria rodar" ou não segundo o agendador.
export default function DiagAgendadorModal({ onClose }: Props) {
  const diagQuery = useQuery({ queryKey: ['coleta-diag-agendador'], queryFn: getDiagAgendador })
  const d = diagQuery.data

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: 780 }}>
        <div className="modal-header">
          <span>🔍 Diagnóstico do Agendador</span>
          <button className="modal-close" aria-label="Fechar modal" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {diagQuery.isLoading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>}
          {d && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, fontFamily: "'IBM Plex Mono',monospace" }}>
                Agora (Node): {d.agora_node_local} · TZ: {d.tz_process} · Agendador ativo: {d.agendador_ativo ? 'sim' : 'não'} · Coleta em execução: {d.coleta_em_execucao ? 'sim' : 'não'}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Service Principals (API)</div>
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Nome</th><th>Ativo</th><th>Auto</th><th>Hora</th><th>Dias</th><th>Próxima</th><th>Deveria rodar?</th></tr>
                  </thead>
                  <tbody>
                    {d.api_sps.length === 0 && <tr><td colSpan={7} className="empty-state">Nenhuma SP</td></tr>}
                    {d.api_sps.map((s) => (
                      <tr key={s.id}>
                        <td>{s.nome}</td>
                        <td>{s.ativo ? '✓' : '✕'}</td>
                        <td>{s.auto_coleta ? '✓' : '✕'}</td>
                        <td>{s.hora_execucao ?? '—'}</td>
                        <td style={{ fontSize: 11 }}>{s.dias_semana || '—'}</td>
                        <td style={{ fontSize: 11 }}>{s.proxima_coleta ? new Date(s.proxima_coleta).toLocaleString('pt-BR') : '—'}</td>
                        <td style={{ color: s.deveria_rodar ? '#22c55e' : 'var(--text-muted)', fontWeight: 700 }}>{s.deveria_rodar ? 'SIM' : 'não'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Storage Accounts</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>Nome</th><th>Ativo</th><th>Hora</th><th>Dias</th><th>Próxima</th><th>Deveria rodar?</th></tr>
                  </thead>
                  <tbody>
                    {d.storage_sps.length === 0 && <tr><td colSpan={6} className="empty-state">Nenhum Storage</td></tr>}
                    {d.storage_sps.map((s) => (
                      <tr key={s.id}>
                        <td>{s.nome}</td>
                        <td>{s.ativo ? '✓' : '✕'}</td>
                        <td>{s.hora_execucao ?? '—'}</td>
                        <td style={{ fontSize: 11 }}>{s.dias_semana || '—'}</td>
                        <td style={{ fontSize: 11 }}>{s.proxima_coleta ? new Date(s.proxima_coleta).toLocaleString('pt-BR') : '—'}</td>
                        <td style={{ color: s.deveria_rodar ? '#22c55e' : 'var(--text-muted)', fontWeight: 700 }}>{s.deveria_rodar ? 'SIM' : 'não'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

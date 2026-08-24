import type { RecursoBilling } from '../types/calculadora'

interface Props {
  recursos: RecursoBilling[]
  onClose: () => void
}

interface Grupo {
  svc: string
  cat: string
  recursos: string[]
}

// Porta de _diagOutros() (calculadora.js:1456) — agrupa os recursos que
// caíram no chip "Outros" (nenhuma regra de tipoRecurso.ts bateu) por
// consumed_service + meter_categories, pra ajudar a identificar padrões
// novos que a classificação ainda não cobre. Usa `meter_categories` (campo
// real da API) em vez do `meter_category` (singular) que _tipoRecurso lê —
// esse último nunca existe na resposta (bug latente preservado de propósito
// na classificação em si, ver tipoRecurso.ts), mas aqui é só um diagnóstico
// read-only: mostrar o campo real ajuda mais do que reproduzir esse bug.
export default function DiagOutrosModal({ recursos, onClose }: Props) {
  const grupos = new Map<string, Grupo>()
  for (const r of recursos) {
    const svc = r.consumed_service || '(vazio)'
    const cat = r.meter_categories || '(vazio)'
    const chave = svc + '\n' + cat
    if (!grupos.has(chave)) grupos.set(chave, { svc, cat, recursos: [] })
    grupos.get(chave)!.recursos.push(r.nome_recurso || r.resource_id || '?')
  }
  const linhas = [...grupos.values()].sort((a, b) => b.recursos.length - a.recursos.length)

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <span style={{ color: 'var(--orange,#ff8c42)' }}>🔍 Diagnóstico — Outros ({recursos.length} recursos)</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
            Grupos únicos de consumed_service + meter_categories não mapeados:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {linhas.map((g) => (
              <div key={g.svc + '\n' + g.cat} style={{ borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>consumed_service</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--orange,#ff8c42)' }}>{g.svc}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>meter_categories</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{g.cat}</span>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {g.recursos.length} recurso{g.recursos.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.recursos.join(', ')}>
                  {g.recursos.slice(0, 4).join(', ')}{g.recursos.length > 4 ? ` …+${g.recursos.length - 4}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

import type { HistoricoItem } from '../types/coleta'

interface Props {
  item: HistoricoItem
  onClose: () => void
}

const STATUS_CFG: Record<string, { color: string; label: string }> = {
  concluido: { color: 'var(--green)', label: 'Concluído' },
  erro: { color: 'var(--danger)', label: 'Erro' },
  cancelado: { color: 'var(--orange)', label: 'Cancelado' },
  executando: { color: 'var(--orange)', label: 'Executando' },
}

const ORIGEM_CFG: Record<string, { color: string; label: string }> = {
  agendado: { color: 'var(--green)', label: '⏰ Agendada' },
  manual: { color: 'var(--blue)', label: '👤 Manual' },
}

const TIPO_LABEL: Record<string, string> = {
  api: 'API Oficial', storage: 'Via Storage', price_list: 'Price List',
}

function formatDuracao(iniciado: string, concluido: string | null): string {
  if (!iniciado || !concluido) return '—'
  const ms = new Date(concluido).getTime() - new Date(iniciado).getTime()
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function stepIcon(msg: string): { icon: string; color: string } {
  if (msg.startsWith('ERRO') || msg.startsWith('Erro') || msg.includes('falhou')) return { icon: '✗', color: 'var(--danger)' }
  if (msg.startsWith('Concluí') || msg.includes('inserido') || msg.includes('✅') || msg.startsWith('OK')) return { icon: '✓', color: 'var(--green)' }
  if (msg.includes('Baixando') || msg.includes('Lendo') || msg.includes('Processando') || msg.includes('Aguard')) return { icon: '⟳', color: 'var(--accent)' }
  if (msg.includes('⚠') || msg.includes('cancelad')) return { icon: '!', color: 'var(--orange)' }
  return { icon: '›', color: 'var(--text-muted)' }
}

// Porta de verDetalhesColeta() (app.js:6281) — log passo a passo de uma
// execução JÁ CONCLUÍDA do histórico (diferente do log ao vivo de ColetaMonitor.tsx,
// que só existe enquanto a coleta está rodando/acabou de rodar nesta sessão).
export default function ColetaLogModal({ item: r, onClose }: Props) {
  const log = r.detalhes?.log || []
  const st = STATUS_CFG[r.status] || { color: 'var(--accent)', label: r.status }
  const origem = r.origem ? ORIGEM_CFG[r.origem] : null
  const tipo = r.tipo ? (TIPO_LABEL[r.tipo] || '—') : '—'

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <span>Log da Coleta #{r.id}</span>
          <button className="modal-close" aria-label="Fechar modal" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14, padding: '12px 14px', background: 'rgba(147,51,234,.08)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Início</div><div style={{ fontSize: 12 }}>{r.iniciado_em ? new Date(r.iniciado_em).toLocaleString('pt-BR') : '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Duração</div><div style={{ fontSize: 12 }}>{formatDuracao(r.iniciado_em, r.concluido_em)}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Status</div><div style={{ fontSize: 12, fontWeight: 600, color: st.color }}>{st.label}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Tipo</div><div style={{ fontSize: 12 }}>{tipo}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Origem</div><div style={{ fontSize: 12, fontWeight: 600, color: origem?.color || 'var(--text-muted)' }}>{origem?.label || '—'}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Inseridos</div><div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{r.linhas_inseridas.toLocaleString('pt-BR')}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Atualizados</div><div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{r.linhas_atualizadas.toLocaleString('pt-BR')}</div></div>
            {r.linhas_erro > 0 && (
              <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Erros</div><div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>{r.linhas_erro.toLocaleString('pt-BR')}</div></div>
            )}
          </div>
          {r.mensagem && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12, padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
              {r.mensagem}
            </div>
          )}
          {log.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>
              Nenhum log disponível para esta execução.<br />
              <span style={{ fontSize: 10 }}>Logs são salvos a partir desta versão.</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '.05em', textTransform: 'uppercase' }}>
                {log.length} entradas de log
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                {log.map((l, i) => {
                  const si = stepIcon(l.msg)
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,.025)', fontSize: 11 }}>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', paddingTop: 1, minWidth: 52 }}>{l.ts}</span>
                      <span style={{ color: si.color, fontWeight: 700, minWidth: 10, paddingTop: 1 }}>{si.icon}</span>
                      <span style={{ color: 'var(--text)', lineHeight: 1.4, wordBreak: 'break-word' }}>{l.msg}</span>
                    </div>
                  )
                })}
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

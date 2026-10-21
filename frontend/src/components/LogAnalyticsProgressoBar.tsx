import { useQuery } from '@tanstack/react-query'
import { getProgressoLogAnalytics, type LogAnalyticsExecucao } from '../api/logAnalytics'

// Acompanhamento das coletas de Log Analytics (2026-10-20, pedido do usuário: "quando pedimos
// para atualizar os dados não mostra os status da atualização").
//
// As três coletas da tela são longas — a principal levou 83 min no último startup e os
// Diagnostic Settings, 456s. Até aqui o botão virava "Coletando..." e nada mais acontecia na
// tela por minutos; não dava pra distinguir progresso de travamento.
//
// Mostra o que ACABOU de terminar por alguns minutos (o servidor segura no TTL), senão a barra
// sumiria no instante da conclusão — e sumiço é indistinguível de "a tela perdeu o estado".

const ROTULO: Record<LogAnalyticsExecucao['tipo'], string> = {
  coleta: 'Coleta geral',
  diagnostic: 'Diagnostic Settings',
  ingestao_recurso: 'Atribuição por recurso',
  backfill_volume: 'Backfill de volume',
}

function duracao(segundos: number) {
  if (segundos < 60) return `${segundos}s`
  const min = Math.floor(segundos / 60)
  return min < 60 ? `${min}min ${segundos % 60}s` : `${Math.floor(min / 60)}h ${min % 60}min`
}

export default function LogAnalyticsProgressoBar() {
  const { data } = useQuery({
    queryKey: ['log-analytics-progresso'],
    queryFn: getProgressoLogAnalytics,
    // Enquanto algo roda, acompanha de perto; parado, espaça pra não ficar batendo à toa.
    // `query.state.data` e não o `data` de fora: dentro do callback o valor de fora está
    // congelado no render em que a query foi criada.
    refetchInterval: (query) =>
      query.state.data?.execucoes?.some((e) => e.em_execucao) ? 2000 : 15000,
  })

  const execucoes = data?.execucoes ?? []
  if (!execucoes.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {execucoes.map((e) => {
        // `total` só é conhecido depois da descoberta; até lá a barra fica indeterminada em
        // vez de fingir 0% — mostrar percentual inventado seria pior que não mostrar.
        const temTotal = e.total > 0
        const pct = temTotal ? Math.min(100, Math.round((e.atual / e.total) * 100)) : null
        const cor = e.erro ? 'var(--red,#ff4d6a)' : e.em_execucao ? 'var(--accent)' : 'var(--green,#22c55e)'
        return (
          <div
            key={e.tipo}
            role="status"
            aria-live="polite"
            style={{
              border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
              background: 'var(--bg-hover)', fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <strong>
                {ROTULO[e.tipo] ?? e.tipo}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  {' — '}{e.fase}
                  {temTotal && ` (${e.atual} de ${e.total})`}
                </span>
              </strong>
              <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {pct !== null && `${pct}% · `}{duracao(e.segundos)}
              </span>
            </div>

            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%', borderRadius: 3, background: cor,
                  width: pct !== null ? `${pct}%` : '100%',
                  opacity: pct === null ? 0.35 : 1,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>

            {(e.erro || e.detalhe) && (
              <div style={{ marginTop: 6, color: e.erro ? 'var(--red,#ff4d6a)' : 'var(--text-muted)' }}>
                {e.erro ? `Falhou: ${e.erro}` : e.detalhe}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

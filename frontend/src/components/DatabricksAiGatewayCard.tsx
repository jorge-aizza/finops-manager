import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { getDatabricksAiGatewayUsage } from '../api/databricksColeta'

// AI Gateway — volume de modelos externos (2026-08-29, auditoria pedida pelo usuário) —
// CORREÇÃO de uma suposição de uma rodada anterior desta sessão: não existe uma coluna de
// "gasto estimado" pra requisições roteadas a modelos externos (OpenAI, Anthropic etc.) —
// confirmado na documentação oficial que system.ai_gateway.usage só tem volume de tokens/
// requisições, nunca R$/US$ (Databricks não sabe quanto o provedor externo cobra por trás
// do Gateway). Por isso este card mostra só VOLUME — Quotas Genie (já implementado, ver
// aba Quotas) CONTROLA limite de uso do Genie via a Budgets API nativa, mas nenhuma feature
// mostra consumo real de OUTROS endpoints de AI Gateway além do Genie até agora.

function fmtNum(v: number): string {
  return v.toLocaleString('pt-BR')
}

export default function DatabricksAiGatewayCard({ periodo }: { periodo: { inicio: string; fim: string } }) {
  const q = useQuery({
    queryKey: ['databricks-ai-gateway-usage', periodo.inicio, periodo.fim],
    queryFn: () => getDatabricksAiGatewayUsage(periodo.inicio, periodo.fim),
    placeholderData: keepPreviousData,
  })
  const data = q.data

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">AI Gateway — Uso de Modelos Externos</span>
        {data && data.total > 0 && <span className="badge">{data.total}</span>}
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        Fonte: <code>system.ai_gateway.usage</code>. <strong>Sem custo em R$/US$</strong> —
        a documentação oficial confirma que essa tabela não tem coluna de gasto: o Databricks
        não sabe quanto o provedor externo (OpenAI, Anthropic etc.) cobra por trás do Gateway,
        só registra volume de tokens/requisições.
      </div>

      {q.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

      {data && data.total === 0 && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Nenhum uso encontrado no período. Se o schema <code>system.ai_gateway</code> não
          estiver habilitado na conta Databricks, este card fica sempre vazio.
        </div>
      )}

      {data && data.total > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Destino</th><th>Modelo</th><th style={{ textAlign: 'right' }}>Requisições</th><th style={{ textAlign: 'right' }}>Tokens de entrada</th><th style={{ textAlign: 'right' }}>Tokens de saída</th></tr>
            </thead>
            <tbody>
              {data.destinos.map((d) => (
                <tr key={d.destination_name + '/' + (d.destination_model || '')}>
                  <td>{d.destination_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.destination_model || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtNum(d.requisicoes)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtNum(d.input_tokens)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{fmtNum(d.output_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

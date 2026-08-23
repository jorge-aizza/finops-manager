import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { getReconciliacao } from '../api/calculadora'

function brl(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
}

function pct(v: number, t: number): string {
  return t > 0 ? (v / t * 100).toFixed(1) + '%' : '—'
}

interface ReconciliacaoModalProps {
  subscriptionIds: string[]
  resourceGroups: string[]
  dataInicio: string
  dataFim: string
  taxaBrl: number
  onClose: () => void
}

// Porta de #crecon-modal + abrirReconciliacao()/_renderReconciliacao()/
// _onAzureRefInput() (calculadora.js). Diferente de Purge/Diagnóstico, este
// modal NÃO podia ser bridgeado pra legado — _reconciliacao só era populado
// como efeito colateral da busca legada de recursos (_carregarRecursos()),
// que a tela React nunca chama; então precisa buscar seus próprios dados via
// useQuery, independente do resto da Calculadora.
export default function ReconciliacaoModal({ subscriptionIds, resourceGroups, dataInicio, dataFim, taxaBrl, onClose }: ReconciliacaoModalProps) {
  const [azureRefInput, setAzureRefInput] = useState('')

  const query = useQuery({
    queryKey: ['calc-reconciliacao', subscriptionIds, resourceGroups, dataInicio, dataFim],
    queryFn: () => getReconciliacao({ subscription_id: subscriptionIds, resource_group: resourceGroups, data_inicio: dataInicio, data_fim: dataFim }),
    enabled: subscriptionIds.length > 0,
  })

  const azureRefValue = parseFloat(azureRefInput.replace(/[^\d,]/g, '').replace(',', '.')) || 0
  const dbTotal = query.data?.total_bruto ?? 0
  const dif = azureRefValue > 0 ? azureRefValue - dbTotal : null
  const difPct = (dif !== null && azureRefValue > 0) ? '(' + (Math.abs(dif) / azureRefValue * 100).toFixed(1) + '%)' : ''
  const showGapNote = dif !== null && Math.abs(dif) > 1

  const moedas = query.data?.por_moeda || []
  const multiMoeda = moedas.length > 1 || (moedas.length === 1 && moedas[0].moeda !== 'BRL')

  // Portal pro <body> — mesmo fix de ConfigurarEstimativaOverlay.tsx: sem
  // isso, este modal fica recortado pelo overflow:hidden do container raiz
  // de CalculadoraView.tsx.
  return createPortal(
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(96vw, 560px)' }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Azure Cost Management</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>Reconciliação de Valores</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!subscriptionIds.length && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>Selecione uma assinatura primeiro.</div>
          )}
          {subscriptionIds.length > 0 && query.isLoading && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>Carregando reconciliação...</div>
          )}
          {query.isError && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--danger)', fontSize: 12 }}>Erro ao carregar reconciliação.</div>
          )}
          {query.data && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'rgba(147,51,234,.1)', border: '1px solid rgba(147,51,234,.25)' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Total no Banco</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace" }}>{brl(dbTotal)}</div>
                </div>
                <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Azure Portal (referência)</div>
                  <input
                    type="text" value={azureRefInput} placeholder="ex: 49.745,18"
                    onChange={(e) => setAzureRefInput(e.target.value)}
                    style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(34,197,94,.4)', outline: 'none', fontSize: 15, fontWeight: 700, color: 'var(--green)', fontFamily: "'IBM Plex Mono',monospace", padding: 0, marginTop: 2 }}
                  />
                </div>
                <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'rgba(255,77,106,.08)', border: '1px solid rgba(255,77,106,.2)' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Diferença</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', fontFamily: "'IBM Plex Mono',monospace" }}>{dif !== null ? brl(Math.abs(dif)) : '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{difPct}</div>
                  </div>
                </div>
              </div>

              {showGapNote && (
                <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,140,66,.08)', border: '1px solid rgba(255,140,66,.25)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  <strong style={{ color: '#ff8c42' }}>Por que há diferença?</strong> O CSV de detalhe de uso do Azure <strong style={{ color: 'var(--text)' }}>não exporta impostos fiscais brasileiros</strong> (ISS ~5% + PIS/COFINS ~3,65% ≈ 8–11%). Esses tributos aparecem apenas no portal e na fatura, mas <em>não como linhas separadas no arquivo exportado</em>. Para reconciliar completamente, solicite o <strong style={{ color: 'var(--text)' }}>relatório de fatura detalhado</strong> (Invoice Details) em vez do Cost Details.
                </div>
              )}

              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 8 }}>Por Charge Type</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,.04)' }}>
                      <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'left' }}>Charge Type</th>
                      <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'right' }}>Linhas</th>
                      <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'right' }}>Total (BRL)</th>
                      <th style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'right' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.por_tipo.map((t) => (
                      <tr key={t.charge_type} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text)' }}>{t.charge_type}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{t.linhas.toLocaleString('pt-BR')}</td>
                        <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace" }}>{brl(t.total)}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{pct(t.total, dbTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {multiMoeda && (
                <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 8, background: 'rgba(77,166,255,.08)', border: '1px solid rgba(77,166,255,.2)' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--blue)', marginBottom: 8 }}>Moedas no banco</div>
                  {moedas.map((m) => (
                    <div key={m.moeda} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                      <span style={{ color: 'var(--text-dim)' }}>{m.moeda}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--blue)' }}>{brl(m.total)}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>Taxa de câmbio manual aplicada: {taxaBrl.toFixed(2)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listProjetos } from '../api/projetos'
import { createEstimativa } from '../api/estimativas'
import { buildPdfHtml } from '../lib/buildPdfHtml'
import type { EstimativaCalculada, Periodo } from '../types/calculadora'
import type { Estimativa, EstimativaInput } from '../types/estimativa'

// Projeto mínimo consumido por este modal — reaproveitado tanto pelo
// endpoint privado (Projeto, com `diretoria`) quanto pelo público
// (ProjetoPublico, sem `diretoria`); os usos de `diretoria` abaixo já
// checam presença antes de exibir.
interface ProjetoOption {
  id: number
  nome: string
  diretoria?: string | null
  descricao: string | null
}

export interface InvoiceModalApi {
  listProjetos: () => Promise<ProjetoOption[]>
  createEstimativa: (input: EstimativaInput) => Promise<Estimativa>
}

const defaultApi: InvoiceModalApi = { listProjetos, createEstimativa }

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const VALIDADE_DIAS = 5

// Porta de #cinv-modal + abrirInvoice()/gerarInvoicePDF()/_atualizarPreviewInvoice()
// (calculadora.js) — formulário de metadados do invoice (projeto/título/
// responsável/e-mail/motivo), com prévia ao vivo da estimativa, chamado só
// pelo fluxo "Visualizar Estimativa" da Calculadora (estimativas já salvas,
// vindas de EstimativasView, pulam direto pro preview — já têm tudo).
interface InvoiceModalProps {
  estimativa: EstimativaCalculada
  periodos: Periodo[]
  onClose: () => void
  onGerado: (html: string, title: string) => void
  api?: InvoiceModalApi
  defaultResp?: string
  defaultEmail?: string
}

export default function InvoiceModal({
  estimativa, periodos, onClose, onGerado, api = defaultApi, defaultResp = '', defaultEmail = '',
}: InvoiceModalProps) {
  const projetosQuery = useQuery({ queryKey: ['projetos', api === defaultApi ? 'privada' : 'publica'], queryFn: api.listProjetos })
  const [projetoId, setProjetoId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [resp, setResp] = useState(defaultResp)
  const [email, setEmail] = useState(defaultEmail)
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState('')

  const projetoSelecionado = useMemo(
    () => (projetosQuery.data || []).find((p) => String(p.id) === projetoId),
    [projetosQuery.data, projetoId],
  )

  // ── Prévia — porta de _atualizarPreviewInvoice() ──
  const itensDinamicos = estimativa.resultados.filter((r) => r.tipo_custo !== 'mes')
  const catPrev = useMemo(() => {
    const m = new Map<string, { count: number; horas: number; total: number; allPeriodo: boolean }>()
    for (const r of itensDinamicos) {
      const cat = r.categoria || 'Outros'
      if (!m.has(cat)) m.set(cat, { count: 0, horas: 0, total: 0, allPeriodo: true })
      const c = m.get(cat)!
      c.count++
      c.total += r.estimado_brl || 0
      const tc = r.tipo_custo || (r.isHora ? 'hora' : 'periodo')
      if (tc !== 'periodo') { c.allPeriodo = false; c.horas += r.horas || 0 }
    }
    return [...m.entries()]
  }, [itensDinamicos])

  const hPrev = estimativa.horas || 0
  const totPrev = estimativa.total_brl || 0
  const taxPrev = hPrev > 0 ? totPrev / hPrev : 0

  function submit() {
    setErro('')
    if (!projetoId) { setErro('Selecione um projeto.'); return }
    if (!obs.trim()) { setErro('Informe o motivo da solicitação do ambiente ligado.'); return }

    const nomeProjeto = projetoSelecionado
      ? projetoSelecionado.nome + (projetoSelecionado.diretoria ? ' · ' + projetoSelecionado.diretoria : '')
      : ''
    const dataFmt = new Date(data + 'T12:00:00').toLocaleDateString('pt-BR')
    const dataValid = new Date(new Date(data + 'T12:00:00').getTime() + VALIDADE_DIAS * 86400000).toLocaleDateString('pt-BR')
    const invoiceNum = 'EST-' + Date.now().toString().slice(-6)

    api.createEstimativa({
      projeto_id: projetoId ? Number(projetoId) : null,
      projeto_nome: nomeProjeto,
      numero: invoiceNum,
      titulo: titulo.trim() || 'Estimativa de Custos Azure',
      responsavel: resp.trim(),
      validade_dias: VALIDADE_DIAS,
      data_estimativa: data,
      horas: estimativa.horas,
      pct_imposto: estimativa.pct_imposto,
      pct_cond: estimativa.pct_cond,
      vl_imposto: estimativa.vl_imposto,
      vl_cond: estimativa.vl_cond,
      total_brl: estimativa.total_brl,
      total_final: estimativa.total_final,
      observacoes: obs.trim(),
      recursos: estimativa.resultados,
    }).catch(() => {})

    const html = buildPdfHtml({
      invoiceNum, dataFmt, dataValid, nomeProjeto,
      titulo: titulo.trim() || 'Estimativa de Custos Azure',
      resp: resp.trim(), email: email.trim(), obs: obs.trim(),
      itens: estimativa.resultados,
      horas: estimativa.horas,
      total_brl: estimativa.total_brl,
      total_fixo_mes: estimativa.total_fixo_mes,
      total_final: estimativa.total_final,
      pct_imposto: estimativa.pct_imposto,
      vl_imposto: estimativa.vl_imposto,
      pct_cond: estimativa.pct_cond,
      vl_cond: estimativa.vl_cond,
      periodos: periodos.length > 0 ? periodos : null,
    })

    window.showToast?.('Estimativa gerada: ' + invoiceNum, 'success')
    onGerado(html, (titulo.trim() || 'Estimativa') + ' · ' + invoiceNum)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(96vw, 680px)' }}>
        <div className="modal-header">
          <span>Gerar Estimativa</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="cinv-projeto">Projeto *</label>
            <select id="cinv-projeto" className="cs" value={projetoId} onChange={(e) => setProjetoId(e.target.value)}>
              <option value="">{projetosQuery.isLoading ? 'Carregando projetos...' : '— selecione o projeto —'}</option>
              {(projetosQuery.data || []).map((p) => (
                <option key={p.id} value={p.id}>{p.nome}{p.diretoria ? ' · ' + p.diretoria : ''}</option>
              ))}
            </select>
            {projetoSelecionado && (
              <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{projetoSelecionado.nome}</strong>
                {projetoSelecionado.diretoria && <> &nbsp;·&nbsp; <span>{projetoSelecionado.diretoria}</span></>}
                {projetoSelecionado.descricao && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{projetoSelecionado.descricao}</div>}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '16px 0' }}>
            <div className="form-group">
              <label htmlFor="cinv-titulo">Título da Estimativa</label>
              <input id="cinv-titulo" type="text" className="ci" placeholder="Ex: Estimativa Abril 2026" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="cinv-data">Data da Estimativa</label>
              <input id="cinv-data" type="date" className="ci" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="cinv-resp">Responsável</label>
              <input id="cinv-resp" type="text" className="ci" placeholder="Nome do responsável" value={resp} onChange={(e) => setResp(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="cinv-email">E-mail</label>
              <input id="cinv-email" type="email" className="ci" placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 5 }}>
            <span style={{ color: 'var(--orange)', fontSize: 13, flexShrink: 0 }}>⚠</span>
            <span>Válida por {VALIDADE_DIAS} dias. Após o prazo, abra uma nova solicitação.</span>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label htmlFor="cinv-obs">Motivo da Solicitação <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea id="cinv-obs" className="ci" rows={2} style={{ height: 60, resize: 'none' }}
              placeholder="Informe o motivo da solicitação do ambiente ligado..." value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>

          {erro && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Prévia da Estimativa</div>

            {periodos.length > 0 && (
              <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(147,51,234,.08)', border: '1px solid rgba(147,51,234,.22)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--accent)', marginBottom: 7 }}>Períodos Selecionados</div>
                {periodos.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, padding: '3px 0', borderBottom: '1px solid rgba(147,51,234,.1)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>{i + 1}.&nbsp;&nbsp;{p.inicio.replace('T', ' ')} → {p.fim.replace('T', ' ')}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent)', marginLeft: 10, flexShrink: 0 }}>{p.horas}h</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, paddingTop: 6 }}>
                  <span style={{ color: 'var(--text)' }}>Total de Horas</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--accent)' }}>{periodos.reduce((s, p) => s + p.horas, 0)}h</span>
                </div>
              </div>
            )}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 8 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(147,51,234,.25)' }}>
                  <th style={{ textAlign: 'left', padding: '3px 0', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Tipo</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>Qtd</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>Horas</th>
                  <th style={{ textAlign: 'right', padding: '3px 0', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {catPrev.map(([cat, info]) => (
                  <tr key={cat} style={{ borderBottom: '1px solid rgba(147,51,234,.07)' }}>
                    <td style={{ padding: '5px 0', color: 'var(--text)', fontWeight: 500 }}>{cat}</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px', color: 'var(--text-muted)' }}>{info.count}</td>
                    <td style={{ textAlign: 'right', padding: '5px 6px', color: 'var(--text-dim)', fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>
                      {info.allPeriodo ? '/mês' : Math.round(info.horas / Math.max(info.count, 1)).toLocaleString('pt-BR') + ' h'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '5px 0', color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>R$ {brl(info.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {estimativa.total_fixo_mes > 0 && (
              <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(77,166,255,.07)', border: '1px solid rgba(77,166,255,.28)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue,#4da6ff)' }}>🔒 Infra Fixa/mês</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: 'var(--blue,#4da6ff)' }}>R$ {brl(estimativa.total_fixo_mes)}</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3 }}>
                  {estimativa.recursos_mes.length} recurso{estimativa.recursos_mes.length !== 1 ? 's' : ''} com custo mensal fixo — cobrado independente das horas do projeto, não soma no Total Final abaixo.
                </div>
              </div>
            )}

            {hPrev > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 4px', padding: '5px 8px', borderRadius: 5, background: 'rgba(147,51,234,.07)', border: '1px solid rgba(147,51,234,.15)' }}>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>⏱ Horas estimadas</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                  {hPrev.toLocaleString('pt-BR')} h
                  {taxPrev > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>≈ R$ {brl(taxPrev)}/h</span>}
                </span>
              </div>
            )}

            {estimativa.pct_imposto > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>+ Imposto ({estimativa.pct_imposto}%)</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>R$ {brl(estimativa.vl_imposto)}</span>
              </div>
            )}
            {estimativa.pct_cond > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>+ Condomínio ({estimativa.pct_cond}%)</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>R$ {brl(estimativa.vl_cond)}</span>
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>Total Final (BRL)</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', fontFamily: "'IBM Plex Mono',monospace" }}>R$ {brl(estimativa.total_final || estimativa.total_brl)}</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={submit}>Visualizar Estimativa</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import CmsMultiSelect from '../components/CmsMultiSelect'
import RecursosTable from '../components/RecursosTable'
import InvoicePreviewModal from '../components/InvoicePreviewModal'
import { useCalculadora, type CalculadoraApi } from '../hooks/useCalculadora'
import { getRecursosPublica, listResourceGroupsPublica, listSubscriptionsPublica, createEstimativaPublica, listProjetosPublica } from '../api/calculadoraPublica'
import { tipoColor, tipoRecurso } from '../lib/tipoRecurso'
import ConfigurarEstimativaOverlay, { type PublicTaxConfig } from './ConfigurarEstimativaOverlay'
import InvoiceModal from './InvoiceModal'
import type { EstimativaCalculada, Periodo } from '../types/calculadora'
import type { PortalConfig, PortalIdentSessao } from '../types/portal'

const TAXA_BRL_FALLBACK = 5.70

// useCalculadora já ordena o resultado via sortRgsComFilhos internamente
// (rgOptions) — não precisa duplicar aqui.
const PUBLIC_API: CalculadoraApi = {
  listSubscriptions: listSubscriptionsPublica,
  listResourceGroups: listResourceGroupsPublica,
  getRecursos: getRecursosPublica,
}

const INVOICE_API = { listProjetos: listProjetosPublica, createEstimativa: createEstimativaPublica }

interface Props {
  cfg: PortalConfig
  ident: PortalIdentSessao | null
}

// Porta React do fluxo de consulta/estimativa do Portal Público — antes
// calculadora.js legado via Calculadora.init({apiBase:'/api/public/calculadora',
// publico:true, defaultConfig}). Reaproveita o mesmo motor (useCalculadora,
// ConfigurarEstimativaOverlay, InvoiceModal) da Calculadora autenticada,
// trocando só a API (endpoints /api/public/calculadora/*, já filtrados no
// servidor por portalCfg) e aplicando as restrições de _aplicarRestricoesPortal():
// período/seleção de recursos podem vir travados pelo admin.
export default function PublicCalculadoraView({ cfg, ident }: Props) {
  const calc = useCalculadora(PUBLIC_API, 'publica')
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [invoiceData, setInvoiceData] = useState<{ estimativa: EstimativaCalculada; periodos: Periodo[] } | null>(null)
  const [preview, setPreview] = useState<{ html: string; title: string } | null>(null)

  const permitirPeriodo = !!cfg.permitir_selecao_periodo
  const permitirRecursos = !!cfg.permitir_selecao_recursos

  // permitir_selecao_recursos=false: sem seleção manual — tudo que a busca
  // trouxer é automaticamente marcado (igual a buscarRecursos() no legado).
  useEffect(() => {
    if (permitirRecursos) return
    if (calc.recursos.length && Object.keys(calc.selecionados).length === 0) {
      calc.checkAll(true)
    }
  }, [permitirRecursos, calc.recursos, calc.selecionados, calc.checkAll])

  // Taxas/horário livre sempre vêm da config do admin no portal público — o
  // endpoint GET /config preenche taxa_imposto/taxa_cond/horario_livre com
  // defaults (18.65/13/desativado) quando o admin nunca configurou, então
  // esses campos nunca chegam null aqui — sempre travados pro público.
  const publicTaxConfig: PublicTaxConfig = useMemo(() => ({
    cond: cfg.taxa_cond,
    horarioLivre: cfg.horario_livre,
  }), [cfg.taxa_cond, cfg.horario_livre])

  const subOptions = useMemo(
    () => (calc.subsQuery.data || []).map((s) => ({ value: s.subscription_id, label: s.subscription_name || s.subscription_id })),
    [calc.subsQuery.data],
  )
  const rgOptionsUi = useMemo(
    () => calc.rgOptions.map((r) => ({
      value: r.resource_group_name,
      label: r.resource_group_name,
      sublabel: r.managed_type ? `${r.managed_type === 'databricks' ? '⚡ Databricks' : '☸ AKS'} — ${r.managed_label || ''}` : undefined,
      parentValue: r.parent_rg,
    })),
    [calc.rgOptions],
  )

  const subLabel = calc.subsSel.length
    ? (calc.subsSel.length === 1
      ? (calc.subsQuery.data || []).find((s) => s.subscription_id === calc.subsSel[0])?.subscription_name || calc.subsSel[0]
      : `${calc.subsSel.length} assinaturas`)
    : '— selecione —'
  const rgLabel = calc.rgsSel.length
    ? (calc.rgsSel.length === 1 ? calc.rgsSel[0] : `${calc.rgsSel.length} resource groups`)
    : (calc.subsSel.length ? '— selecione —' : '— selecione a assinatura —')

  const contagemTipos = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of calc.recursos) {
      const t = tipoRecurso(r)
      m.set(t, (m.get(t) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [calc.recursos])

  const totalSelecionados = Object.keys(calc.selecionados).length
  const totalRecursos = calc.grupos.length
  const totalLinhas = calc.recursosFiltrados.length

  function handleOpenOverlay() {
    setOverlayOpen(true)
    calc.carregarPico()
  }

  return (
    <div className="portal-calc-wrap">
      {/* --ck-radius / --ck-shadow so existem sob [data-theme="light"] (bloco do
          cockpit em styles.css). O fallback mantem o escuro exatamente como
          estava -- e por isso sao variaveis e nao valores fixos aqui. */}
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--ck-radius, 14px)', boxShadow: 'var(--ck-shadow, none)', overflow: 'hidden', background: 'var(--bg-card)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 10, alignItems: 'end', padding: '13px 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="cfg">
            <label className="cl">Assinatura</label>
            <CmsMultiSelect
              values={calc.subsSel}
              options={subOptions}
              searchPlaceholder="Buscar..."
              triggerLabel={subLabel}
              loading={calc.subsQuery.isLoading}
              onChange={calc.commitSubs}
            />
          </div>
          <div className="cfg">
            <label className="cl">Resource Group</label>
            <CmsMultiSelect
              values={calc.rgsSel}
              options={rgOptionsUi}
              searchPlaceholder="Buscar..."
              triggerLabel={rgLabel}
              loading={calc.rgQuery.isLoading}
              onChange={calc.setRgsSel}
            />
          </div>
          <div className="cfg">
            <label className="cl">Período{!permitirPeriodo && ' 🔒'}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input type="date" value={calc.dataInicio} disabled={!permitirPeriodo} onChange={(e) => calc.setDataInicio(e.target.value)}
                style={{ height: 34, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, minWidth: 128, opacity: permitirPeriodo ? 1 : 0.6 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→</span>
              <input type="date" value={calc.dataFim} disabled={!permitirPeriodo} onChange={(e) => calc.setDataFim(e.target.value)}
                style={{ height: 34, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, minWidth: 128, opacity: permitirPeriodo ? 1 : 0.6 }} />
            </div>
          </div>
          <div className="cfg">
            <button
              className="cbtn-go" onClick={calc.buscarRecursos} disabled={!calc.rgsSel.length || calc.loading}
              style={{ height: 34, padding: '0 14px', opacity: (!calc.rgsSel.length || calc.loading) ? 0.4 : 1, cursor: (!calc.rgsSel.length || calc.loading) ? 'not-allowed' : 'pointer' }}
              title={calc.rgsSel.length ? '' : 'Selecione pelo menos um Resource Group para buscar'}
            >
              {calc.loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 360 }}>
          <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text" className="ci" placeholder="Filtrar recursos..." value={calc.filtroTexto}
              onChange={(e) => calc.setFiltroTexto(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {totalRecursos} recurso{totalRecursos !== 1 ? 's' : ''}{totalLinhas > totalRecursos ? ` · ${totalLinhas} linhas` : ''}
            </span>
            {permitirRecursos && (
              <>
                <button className="cbtn-sec" onClick={() => calc.checkAll(true)}>Sel. todos</button>
                <button className="cbtn-sec" onClick={() => calc.checkAll(false)}>Limpar</button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <button
              className="btn-primary" disabled={totalSelecionados === 0} onClick={handleOpenOverlay}
              style={{ opacity: totalSelecionados === 0 ? 0.5 : 1, cursor: totalSelecionados === 0 ? 'not-allowed' : 'pointer' }}
            >
              Estimar
            </button>
          </div>

          {contagemTipos.length > 0 && (
            <div style={{ padding: '6px 13px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>Tipo:</span>
              {contagemTipos.map(([tipo, cnt]) => {
                const ativo = calc.filtroTipos.size === 0 || calc.filtroTipos.has(tipo)
                const col = tipoColor(tipo)
                return (
                  <button
                    key={tipo} onClick={() => calc.toggleTipo(tipo)}
                    title={`${tipo}: ${cnt} recurso${cnt !== 1 ? 's' : ''}`}
                    style={{
                      fontSize: 10, padding: '2px 9px', borderRadius: 10,
                      border: '1px solid ' + (ativo ? 'var(--accent)' : 'var(--border)'),
                      background: ativo ? 'rgba(147,51,234,.15)' : 'rgba(255,255,255,.04)',
                      color: ativo ? col : 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {tipo} <span style={{ opacity: 0.7 }}>{cnt}</span>
                  </button>
                )
              })}
            </div>
          )}

          {calc.erro && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--danger)', fontSize: 12 }}>⚠ Erro: {calc.erro}</div>
          )}

          {!calc.erro && !calc.subsSel.length && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 30, textAlign: 'center' }}>
              Selecione uma <strong style={{ color: 'var(--text)' }}>Assinatura</strong>, confirme com <strong style={{ color: 'var(--accent)' }}>OK ✓</strong> e clique em <strong style={{ color: 'var(--accent)' }}>Buscar</strong>.
            </div>
          )}

          {!calc.erro && calc.subsSel.length > 0 && calc.loading && (
            <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="cspinner" />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Buscando recursos...</span>
            </div>
          )}

          {!calc.erro && calc.subsSel.length > 0 && !calc.loading && (
            <div style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
              <RecursosTable
                grupos={calc.grupos}
                selecionados={calc.selecionados}
                expandedGroups={calc.expandedGroups}
                dbTaxaMap={calc.dbTaxaMap}
                taxaBrl={TAXA_BRL_FALLBACK}
                onToggleGrupo={calc.toggleGrupo}
                onCheck={calc.check}
                onCheckGrupo={calc.checkGrupo}
                locked={!permitirRecursos}
              />
            </div>
          )}
        </div>
      </div>

      {overlayOpen && (
        <ConfigurarEstimativaOverlay
          calc={calc}
          taxaBrl={TAXA_BRL_FALLBACK}
          publicConfig={publicTaxConfig}
          taxaImpostoAdmin={cfg.taxa_imposto}
          impostoSplit={{ microsoft: cfg.imposto_microsoft, marketplace: cfg.imposto_marketplace }}
          onClose={() => setOverlayOpen(false)}
          onVisualizarEstimativa={(estimativa, periodos) => {
            setOverlayOpen(false)
            setInvoiceData({ estimativa, periodos })
          }}
        />
      )}

      {invoiceData && (
        <InvoiceModal
          estimativa={invoiceData.estimativa}
          periodos={invoiceData.periodos}
          api={INVOICE_API}
          origem="portal"
          defaultResp={ident?.nome || ''}
          defaultEmail={ident?.email || ''}
          onClose={() => setInvoiceData(null)}
          onGerado={(html, title) => { setInvoiceData(null); setPreview({ html, title }) }}
        />
      )}

      {preview && (
        <InvoicePreviewModal html={preview.html} title={preview.title} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

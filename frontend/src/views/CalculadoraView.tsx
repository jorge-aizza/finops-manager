import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDetalheDiario, getPorServico } from '../api/calculadora'
import CmsMultiSelect from '../components/CmsMultiSelect'
import RecursosTable from '../components/RecursosTable'
import DetalheDiarioTable from '../components/DetalheDiarioTable'
import PorServicoTable from '../components/PorServicoTable'
import { useCalculadora } from '../hooks/useCalculadora'
import { tipoColor, tipoRecurso } from '../lib/tipoRecurso'
import ConfigurarEstimativaOverlay from './ConfigurarEstimativaOverlay'

const TAXA_BRL_FALLBACK = 5.70

export default function CalculadoraView() {
  const calc = useCalculadora()
  const [overlayOpen, setOverlayOpen] = useState(false)

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

  // Contagem por tipo pra chip-bar (sobre a lista JÁ filtrada por texto, não
  // pelos próprios chips — mesmo padrão do legado, pra não "sumir" chips ao
  // ativar outro).
  const contagemTipos = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of calc.recursos) {
      const t = tipoRecurso(r)
      m.set(t, (m.get(t) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [calc.recursos])

  const detalheQuery = useQuery({
    queryKey: ['calc-detalhe', calc.subsSel, calc.rgsSel, calc.dataInicio, calc.dataFim],
    queryFn: () => getDetalheDiario({ subscription_id: calc.subsSel, resource_group: calc.rgsSel, data_inicio: calc.dataInicio, data_fim: calc.dataFim }),
    enabled: calc.visao === 'detalhe' && calc.subsSel.length > 0,
  })
  const servicoQuery = useQuery({
    queryKey: ['calc-servico', calc.subsSel, calc.rgsSel, calc.dataInicio, calc.dataFim],
    queryFn: () => getPorServico({ subscription_id: calc.subsSel, resource_group: calc.rgsSel, data_inicio: calc.dataInicio, data_fim: calc.dataFim }),
    enabled: calc.visao === 'servico' && calc.subsSel.length > 0,
  })

  const totalSelecionados = Object.keys(calc.selecionados).length
  const totalRecursos = calc.grupos.length
  const totalLinhas = calc.recursosFiltrados.length

  function handleOpenOverlay() {
    setOverlayOpen(true)
    calc.carregarPico()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filtros */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 10, alignItems: 'end', padding: '13px 24px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
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
          <label className="cl">Período</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="date" value={calc.dataInicio} onChange={(e) => calc.setDataInicio(e.target.value)}
              style={{ height: 34, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, minWidth: 128 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→</span>
            <input type="date" value={calc.dataFim} onChange={(e) => calc.setDataFim(e.target.value)}
              style={{ height: 34, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border-light)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, minWidth: 128 }} />
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

      {/* Corpo */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <input
            type="text" className="ci" placeholder="Filtrar recursos..." value={calc.filtroTexto}
            onChange={(e) => calc.setFiltroTexto(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {totalRecursos} recurso{totalRecursos !== 1 ? 's' : ''}{totalLinhas > totalRecursos ? ` · ${totalLinhas} linhas` : ''}
          </span>
          <button className="cbtn-sec" onClick={() => calc.checkAll(true)}>Sel. todos</button>
          <button className="cbtn-sec" onClick={() => calc.checkAll(false)}>Limpar</button>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.06)', borderRadius: 7, padding: 2, flexShrink: 0 }}>
            {(['recursos', 'detalhe', 'servico'] as const).map((v) => (
              <button
                key={v} onClick={() => calc.setVisao(v)}
                style={{ padding: '4px 13px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', background: calc.visao === v ? 'var(--accent)' : 'transparent', color: calc.visao === v ? '#fff' : 'var(--text-muted)' }}
              >
                {v === 'recursos' ? 'Recursos' : v === 'detalhe' ? 'Por Data' : 'Por Serviço'}
              </button>
            ))}
          </div>
          <button
            className="btn-primary" disabled={totalSelecionados === 0} onClick={handleOpenOverlay}
            style={{ opacity: totalSelecionados === 0 ? 0.5 : 1, cursor: totalSelecionados === 0 ? 'not-allowed' : 'pointer' }}
          >
            Estimar
          </button>
        </div>

        {contagemTipos.length > 0 && (
          <div style={{ padding: '6px 13px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
            Selecione uma <strong style={{ color: 'var(--text)' }}>Assinatura</strong>, confirme com <strong style={{ color: 'var(--accent)' }}>OK ✓</strong> e clique em <strong style={{ color: 'var(--accent)' }}>Buscar</strong>.
          </div>
        )}

        {!calc.erro && calc.subsSel.length > 0 && calc.loading && (
          <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cspinner" />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Buscando recursos — <span style={{ color: 'var(--text-dim)' }}>{calc.subsSel.length} assinatura{calc.subsSel.length !== 1 ? 's' : ''}{calc.rgsSel.length ? ` · ${calc.rgsSel.length} RG${calc.rgsSel.length !== 1 ? 's' : ''}` : ''} · {calc.dataInicio || '?'} → {calc.dataFim || '?'}</span>
            </span>
          </div>
        )}

        {!calc.erro && calc.subsSel.length > 0 && !calc.loading && calc.visao === 'recursos' && (
          <RecursosTable
            grupos={calc.grupos}
            selecionados={calc.selecionados}
            expandedGroups={calc.expandedGroups}
            dbTaxaMap={calc.dbTaxaMap}
            taxaBrl={TAXA_BRL_FALLBACK}
            onToggleGrupo={calc.toggleGrupo}
            onCheck={calc.check}
            onCheckGrupo={calc.checkGrupo}
          />
        )}
        {!calc.erro && calc.visao === 'detalhe' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {detalheQuery.isLoading
              ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Carregando...</div>
              : <DetalheDiarioTable rows={detalheQuery.data || []} />}
          </div>
        )}
        {!calc.erro && calc.visao === 'servico' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {servicoQuery.isLoading
              ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Carregando...</div>
              : <PorServicoTable rows={servicoQuery.data || []} />}
          </div>
        )}
      </div>

      {overlayOpen && (
        <ConfigurarEstimativaOverlay calc={calc} taxaBrl={TAXA_BRL_FALLBACK} onClose={() => setOverlayOpen(false)} />
      )}
    </div>
  )
}

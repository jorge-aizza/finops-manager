import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDatabricksCotas } from '../api/databricksColeta'
import type { DatabricksCotaStatus, DatabricksCotaUsuario, DatabricksCotaWorkspace } from '../types/databricksResumo'

// Semáforo de cotas — porte do cockpit "Gestão de Cotas" (Cotas/cockpit-quotas-v51.html)
// para dentro do app.
//
// A diferença que importa: no cockpit o percentual vinha pronto numa planilha,
// descolado das linhas de consumo — auditado e medido, o declarado chegava a 28×
// o que as linhas sustentavam. Aqui o percentual é sempre DERIVADO de
// databricks_consumo no servidor, então não existe caminho onde ele divirja do
// custo exibido ao lado.

const STATUS: Record<DatabricksCotaStatus, { rotulo: string; cor: string }> = {
  ok:         { rotulo: 'Dentro da cota', cor: 'var(--green)' },
  atencao:    { rotulo: 'Atenção',        cor: 'var(--orange)' },
  critico:    { rotulo: 'Crítico',        cor: 'var(--red)' },
  estourado:  { rotulo: 'Estourado',      cor: 'var(--red)' },
  sem_cota:   { rotulo: 'Sem cota',       cor: 'var(--text-muted)' },
}

const brl = (v: number) =>
  'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Medidor({ pct, cor }: { pct: number | null; cor: string }) {
  // A barra satura em 100% para não transbordar o cartão; o número ao lado
  // continua mostrando o valor real (243% aparece como barra cheia + "243%").
  const largura = pct == null ? 0 : Math.min(100, pct)
  return (
    <div style={{
      height: 6, borderRadius: 20, background: 'var(--bg-hover)',
      overflow: 'hidden', flex: 1, minWidth: 60,
    }}>
      <div style={{ height: '100%', width: largura + '%', background: cor, borderRadius: 20 }} />
    </div>
  )
}

function Linha({ titulo, sub, custo, teto, pct, status, extra }: {
  titulo: string; sub?: string | null; custo: number
  teto: number | null; pct: number | null; status: DatabricksCotaStatus; extra?: string | null
}) {
  const s = STATUS[status]
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 16px',
      borderLeft: '3px solid ' + s.cor, borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {titulo}
          </div>
          {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, whiteSpace: 'nowrap' }}>
          {pct == null ? '—' : pct.toFixed(0) + '%'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%', background: s.cor, flexShrink: 0,
        }} />
        <Medidor pct={pct} cor={s.cor} />
        <span style={{ fontSize: 11, color: s.cor, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.rotulo}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {brl(custo)} {teto != null ? 'de ' + brl(teto) + ' disponíveis' : '— nenhum teto configurado'}
        {extra ? ' · ' + extra : ''}
      </div>
    </div>
  )
}

function mesAtual() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export default function DatabricksCotasPanel() {
  // Cota é apurada por MÊS, então o padrão é o mês corrente — é dele que o
  // alerta por e-mail fala. O seletor existe porque a coleta pode estar
  // atrasada (ou o mês recém-virou), e nesses casos olhar o mês anterior é o
  // que responde "como fechamos?".
  const [mes, setMes] = useState(mesAtual())
  const cotasQuery = useQuery({
    queryKey: ['databricks-cotas', mes],
    queryFn: () => getDatabricksCotas(mes),
  })

  const d = cotasQuery.data

  const seletor = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 20px 14px' }}>
      <label htmlFor="dbx-cotas-mes" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
        Mês
      </label>
      <input
        id="dbx-cotas-mes" type="month" value={mes}
        onChange={(e) => e.target.value && setMes(e.target.value)}
        style={{ width: 'auto' }}
      />
      {mes !== mesAtual() && (
        <button className="btn-ghost" onClick={() => setMes(mesAtual())}>Voltar ao mês atual</button>
      )}
    </div>
  )

  if (cotasQuery.isLoading) {
    return <>{seletor}<div className="card" style={{ margin: '0 20px', padding: 20, color: 'var(--text-muted)' }}>Carregando cotas...</div></>
  }
  if (!d || (!d.por_workspace.length && !d.por_usuario.length)) {
    // Acontece de verdade no começo do mês ou com a coleta atrasada: as cotas
    // são mensais, então sem consumo no mês não há o que medir. Dizer isso é
    // melhor do que mostrar uma tela vazia que parece quebrada.
    return (
      <>
        {seletor}
        <div className="card" style={{ margin: '0 20px', padding: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sem consumo no mês {d?.mes || mes}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            As cotas são apuradas por mês. Se a coleta estiver atrasada ou o mês tiver virado há pouco,
            escolha outro mês acima.
          </div>
        </div>
      </>
    )
  }

  const semCota = d.resumo.workspaces_sem_cota
  const acima = d.resumo.usuarios_acima_do_limite

  return (
    <>
      {seletor}
      <div className="stats-grid" style={{ margin: '0 20px 16px' }}>
        <div className="stat-card">
          <div className="stat-label">Consumo no mês</div>
          <div className="stat-value">{brl(d.resumo.custo_total)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>mês {d.mes}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cota configurada</div>
          <div className="stat-value">{brl(d.resumo.cota_total)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>soma dos orçamentos por workspace</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Workspaces sem cota</div>
          <div className="stat-value" style={{ color: semCota ? 'var(--orange)' : undefined }}>{semCota}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>consomem sem teto definido</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Usuários acima do limite</div>
          <div className="stat-value" style={{ color: acima ? 'var(--red)' : undefined }}>{acima}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>estouraram o teto individual</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '0 20px' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Cotas por Workspace</span>
            <span className="badge">{d.por_workspace.length}</span>
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {d.por_workspace.map((w: DatabricksCotaWorkspace) => (
              <Linha
                key={w.workspace_id}
                titulo={w.workspace_id}
                sub={w.budget_nome}
                custo={w.custo} teto={w.cota} pct={w.pct} status={w.status}
              />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Cotas por Usuário</span>
            <span className="badge">{d.por_usuario.length}</span>
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {d.por_usuario.map((u: DatabricksCotaUsuario) => (
              <Linha
                key={u.workspace_id + '|' + u.usuario}
                titulo={u.usuario}
                sub={u.workspace_id}
                custo={u.custo} teto={u.limite} pct={u.pct} status={u.status}
                extra={u.origem_limite === 'individual' ? 'limite individual' : u.origem_limite === 'workspace' ? 'teto do workspace' : null}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

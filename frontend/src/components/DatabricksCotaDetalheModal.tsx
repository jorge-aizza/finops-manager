import type {
  DatabricksCotaStatus, DatabricksCotaUsuario, DatabricksCotaWorkspace,
} from '../types/databricksResumo'

// Modal de detalhe de uma cota — porte fiel do renderEntityModalContent do
// cockpit "Gestão de Cotas" (v56): cabeçalho com pílula de status, 4 destaques
// em grade 2×2 (% utilizado, % disponível, DBU free, DBU pago) e a ficha de
// campos (budget, ação, cota, consumo, saldo).
//
// Duas escolhas do cockpit preservadas de propósito, porque escondê-las seria
// pior do que mostrar número negativo:
//   % disponível  = 100 − pct  → fica NEGATIVO quando estourou (-143%), o que
//                   diz o quanto passou em vez de travar em zero.
//   saldo (USD)   = cota − consumo → mesma ideia, em dólar.

const STATUS_PILL: Record<DatabricksCotaStatus, { cls: string; rotulo: string; cor: string }> = {
  ok:        { cls: 'green',   rotulo: 'Dentro da cota',    cor: 'var(--ck-green)' },
  atencao:   { cls: 'yellow',  rotulo: 'Atenção',           cor: 'var(--ck-yellow)' },
  critico:   { cls: 'red',     rotulo: 'Crítico',           cor: 'var(--ck-red)' },
  estourado: { cls: 'red',     rotulo: 'Cota estourada',    cor: 'var(--ck-red)' },
  sem_cota:  { cls: 'neutral', rotulo: 'Sem cota definida', cor: 'var(--ck-neutral)' },
}

// Mesmo formato do cockpit: no máximo 2 casas, sem mínimo.
const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v)
const usd = (v: number | null) => (v == null ? 'Não informado' : 'US$ ' + fmt(v))
const pctTxt = (v: number | null) => (v == null ? '—' : fmt(v) + '%')

// Como no v56, o sinal de cor fica na BORDA DE CIMA -- o valor em si segue na
// cor de texto padrao, senao o cartao inteiro compete por atencao.
function Destaque({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <article className="ck-metric" style={{ borderTopColor: cor }}>
      <span className="ck-metric-label">{rotulo}</span>
      <strong className="ck-metric-value">{valor}</strong>
    </article>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="ck-field-row">
      <span className="ck-field-label">{rotulo}</span>
      <span className="ck-field-value" title={valor}>{valor}</span>
    </div>
  )
}

interface Props {
  item: DatabricksCotaWorkspace | DatabricksCotaUsuario
  tipo: 'workspace' | 'usuario'
  usuariosDoWs?: DatabricksCotaUsuario[]   // só no modal de workspace
  /** Abre o detalhe de um usuário da lista (drill-down workspace -> usuário). */
  onAbrirUsuario?: (u: DatabricksCotaUsuario) => void
  /** Quando veio de um workspace, o rótulo do caminho de volta. */
  voltarPara?: string | null
  onVoltar?: () => void
  onClose: () => void
}

export default function DatabricksCotaDetalheModal({
  item, tipo, usuariosDoWs = [], onAbrirUsuario, voltarPara, onVoltar, onClose,
}: Props) {
  const ehWs = tipo === 'workspace'
  const w = item as DatabricksCotaWorkspace
  const u = item as DatabricksCotaUsuario

  const titulo = ehWs ? `Workspace · ${w.workspace_id}` : `Usuário · ${u.usuario}`
  const teto = ehWs ? w.cota : u.limite
  const pct = item.pct
  const s = STATUS_PILL[item.status]

  const disponivelPct = pct == null ? null : 100 - pct
  const saldo = teto == null ? null : teto - item.custo
  // negativo = estourou; a cor acompanha para nao passar por "sobra"
  const corDisp = disponivelPct == null ? 'var(--ck-neutral)'
    : disponivelPct < 0 ? 'var(--ck-red)' : 'var(--ck-green)'

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ck-cotas ck-modal-box">
        <button className="ck-modal-close" aria-label="Fechar" onClick={onClose}>✕</button>

        {voltarPara && onVoltar && (
          // sem isso o drill-down seria um beco sem saida: o modal do usuario
          // substitui o do workspace e nao havia como voltar ao que abriu
          <button
            type="button"
            onClick={onVoltar}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              marginBottom: 10, font: 'inherit', fontSize: 12, fontWeight: 700,
              color: 'var(--ck-teal)',
            }}
          >← Voltar para {voltarPara}</button>
        )}

        <div className="ck-panel-head">
          <div>
            <h2>{titulo}</h2>
            <div className="ck-panel-note">Consumo consolidado do mês, derivado da coleta</div>
          </div>
          {/* o cockpit nomeia o escopo na pilula ("Dentro da Quota (workspace)") */}
          <span className={'ck-status-pill ' + s.cls}>
            {s.rotulo} ({ehWs ? 'workspace' : 'usuário'})
          </span>
        </div>

        <div className="ck-highlights">
          <Destaque rotulo="% utilizado" valor={pctTxt(pct)} cor={s.cor} />
          <Destaque rotulo="% disponível" valor={pctTxt(disponivelPct)} cor={corDisp} />
          <Destaque rotulo="DBU Free no mês" valor={fmt(item.dbus_free)} cor="var(--ck-teal)" />
          <Destaque rotulo="DBU Pago no mês" valor={fmt(item.dbus_pago)} cor="var(--ck-magenta)" />
        </div>

        <div className="ck-fields">
          <Campo rotulo="Budget configurado" valor={item.budget_nome || 'Sem budget configurado'} />
          {/* Nossos orçamentos ALERTAM, nunca bloqueiam -- bloqueio de verdade
              só existe nas Quotas Genie (Budgets API nativa). Escrever
              "Bloqueio" aqui, como o cockpit faz, seria falso. */}
          <Campo rotulo="Ação ao estourar a cota" valor={item.budget_nome ? 'Alerta (não bloqueia)' : '—'} />
          <Campo rotulo={ehWs ? 'Cota do workspace (USD)' : 'Limite do usuário (USD)'} valor={usd(teto)} />
          <Campo rotulo={ehWs ? 'Consumo da cota (USD)' : 'Consumo do limite (USD)'} valor={usd(item.custo)} />
          <Campo rotulo="Saldo disponível da cota (USD)" valor={usd(saldo)} />
          {!ehWs && (
            <Campo
              rotulo="Origem do limite"
              valor={u.origem_limite === 'individual' ? 'Exceção individual'
                : u.origem_limite === 'workspace' ? 'Teto por usuário do workspace' : '—'}
            />
          )}
          <Campo rotulo="DBU total no mês" valor={fmt(item.dbus)} />
          {!ehWs && <Campo rotulo="Workspace" valor={u.workspace_id} />}
        </div>

        {ehWs && usuariosDoWs.length > 0 && (
          <>
            <hr className="ck-divider" />
            <div className="ck-field-label" style={{ display: 'block', marginBottom: 10 }}>
              Usuários deste workspace ({usuariosDoWs.length}) — fatia do consumo
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {usuariosDoWs.map((x) => {
                const cs = STATUS_PILL[x.status]
                // A barra e a FATIA do usuario no consumo DESTE workspace --
                // nao o % da cota dele, que ja e o que os cartoes da tela
                // mostram e aqui seria so repeticao. Quando um workspace esta
                // em 97% da cota, a pergunta e "quem esta comendo isso".
                const fatia = w.custo > 0 ? (x.custo / w.custo) * 100 : 0
                return (
                  <button
                    type="button"
                    key={x.usuario}
                    onClick={() => onAbrirUsuario?.(x)}
                    disabled={!onAbrirUsuario}
                    aria-label={`Ver detalhes de Usuário ${x.usuario}`}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                      color: 'inherit', background: 'transparent', border: 'none',
                      borderBottom: '1px solid var(--ck-line)', padding: '9px 2px',
                      cursor: onAbrirUsuario ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', gap: 12,
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: cs.cor, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {x.usuario}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {usd(x.custo)} · {fmt(Math.round(fatia))}%
                      </span>
                    </span>
                    <span className="ck-bar" style={{ display: 'block', marginTop: 6 }}>
                      <span style={{ width: Math.min(100, fatia) + '%', background: cs.cor }} />
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

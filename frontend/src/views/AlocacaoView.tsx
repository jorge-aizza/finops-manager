import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAzureTagsFaltantes, rebuildAzureRecursoTags,
  getAzureTagChaves, getAzureAlocacaoTags, rebuildAzureAlocacaoTags,
  getAzureOrcamentosInventario, getAzureOrcamentosInventarioAlertas, excluirAzureOrcamentoInventario,
  getAzureSerieMensal, getAzureCommitmentCobertura, salvarTagsObrigatorias, getAzureInventarioConfig,
} from '../api/azureInventario'
import { listSubscriptions } from '../api/calculadora'
import { forecastLinear } from '../lib/forecastLinear'
import { mesesCompletos, projecaoMesCorrente } from '../lib/projecaoMes'
import InventarioOrcamentoModal from '../components/InventarioOrcamentoModal'
import type { AzureOrcamentoInventario, AzureOrcamentoSeveridade } from '../types/azureInventario'

// Alocação & Otimização (2026-09-04) — capabilities "Allocation" e "Governance, Policy & Risk"
// do FinOps Framework. View separada do Inventário de propósito: aquele é o plano ARM (Resource
// Graph, quem criou o quê), esta é o plano de BILLING (azure_costs), com audiência financeira.

// Benchmark de mercado (FinOps Foundation, práticas de 2026): a conformidade de tag precisa
// passar de 80% antes dos demais KPIs (rateio, cobertura de commitment) ficarem confiáveis —
// abaixo disso, o denominador de qualquer rateio é chute.
const BENCHMARK_COMPLIANCE = 0.8
// Acima disso a chave é identificador técnico (ClusterId tem 364 mil valores), não dimensão de
// rateio — a UI avisa em vez de deixar o usuário montar um "showback" de 30 mil linhas.
const CARDINALIDADE_ALTA = 1000

const fmtPct = (v: number | null) => (v === null ? '—' : (v * 100).toFixed(1) + '%')
const fmtNum = (v: number) => v.toLocaleString('pt-BR')
const fmtBRL = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca'

// Barras CSS puras — zero lib de gráfico (política do projeto, mesma abordagem do RankingCard
// no dashboard Databricks).
function BarraCompliance({ pct, rotulo = 'conformes', benchmark = BENCHMARK_COMPLIANCE }: { pct: number; rotulo?: string; benchmark?: number }) {
  const cor = pct >= benchmark ? 'var(--green,#22c55e)' : pct >= benchmark * 0.6 ? 'var(--orange,#ff8c42)' : 'var(--red,#ff4d6a)'
  return (
    <div style={{ margin: '10px 0 6px' }}>
      <div style={{ position: 'relative', height: 22, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: Math.min(100, pct * 100) + '%', height: '100%', background: cor, opacity: 0.85 }} />
        <div
          title={'Benchmark de mercado: ' + benchmark * 100 + '%'}
          style={{ position: 'absolute', left: benchmark * 100 + '%', top: 0, bottom: 0, width: 2, background: 'var(--text)', opacity: 0.75 }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
        <span style={{ color: cor, fontWeight: 700 }}>{fmtPct(pct)} {rotulo}</span>
        <span>benchmark {benchmark * 100}%</span>
      </div>
    </div>
  )
}

// ── Showback ────────────────────────────────────────────────────────────────
function ShowbackTab() {
  const [chave, setChave] = useState('')
  const [sub, setSub] = useState('')

  const subsQuery = useQuery({ queryKey: ['calc-subscriptions'], queryFn: listSubscriptions })
  const chavesQuery = useQuery({ queryKey: ['azure-tag-chaves'], queryFn: () => getAzureTagChaves() })
  const alocQuery = useQuery({
    queryKey: ['azure-alocacao-tags', chave, sub],
    queryFn: () => getAzureAlocacaoTags({ chave, subscription_id: sub || undefined }),
    enabled: !!chave,
  })
  const rebuild = useMutation({
    mutationFn: rebuildAzureAlocacaoTags,
    onSuccess: (r) => window.showToast?.(r.message, 'success'),
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const chaves = chavesQuery.data?.chaves || []
  const chaveInfo = chaves.find((c) => c.chave === chave)
  const d = alocQuery.data
  const maxCusto = d?.itens.length ? d.itens[0].custo : 0

  return (
    <>
      <div className="card" style={{ margin: '16px 20px' }}>
        <div className="card-header">
          <span className="card-title">Rateio de Custo por Tag</span>
          <button
            className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }}
            disabled={rebuild.isPending}
            title="Reconstrói o rollup a partir do billing (alguns minutos por mês, roda em background)"
            onClick={() => rebuild.mutate()}
          >
            {rebuild.isPending ? 'Iniciando...' : '↻ Reconstruir rollup'}
          </button>
        </div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Custo real do billing agrupado pela chave de tag escolhida. Lido de um rollup materializado — zero coleta nova.
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={chave} onChange={(e) => setChave(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">Escolha uma chave de tag…</option>
            {chaves.map((c) => (
              <option key={c.chave} value={c.chave}>
                {c.chave} ({fmtNum(c.valores_distintos)} valores)
              </option>
            ))}
          </select>
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">Todas as assinaturas</option>
            {subsQuery.data?.map((s) => (
              <option key={s.subscription_id} value={s.subscription_id}>{s.subscription_name || s.subscription_id}</option>
            ))}
          </select>
          {d?.atualizado_em && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Rollup atualizado {fmtData(d.atualizado_em)}</span>
          )}
        </div>

        {chavesQuery.data && chaves.length === 0 && (
          <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
            Rollup ainda não construído. Clique em <strong>Reconstruir rollup</strong> — ele processa um mês por vez e
            leva alguns minutos.
          </div>
        )}

        {chaveInfo && chaveInfo.valores_distintos > CARDINALIDADE_ALTA && (
          <div style={{ margin: '0 20px 12px', padding: 10, borderRadius: 6, fontSize: 12, background: 'color-mix(in srgb, var(--orange,#ff8c42) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--orange,#ff8c42) 40%, transparent)' }}>
            <strong>{chaveInfo.chave}</strong> tem {fmtNum(chaveInfo.valores_distintos)} valores distintos — é um
            identificador técnico (por execução/cluster), não uma dimensão de rateio. Os valores fora do top 500 aparecem
            agrupados em <code>(outros)</code>.
          </div>
        )}

        {alocQuery.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

        {d && (
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtBRL(d.total)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Custo total do período</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green,#22c55e)' }}>{fmtBRL(d.alocado)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Alocado ({fmtPct(d.pct_alocado)})</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--orange,#ff8c42)' }}>{fmtBRL(d.nao_alocado)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sem esta tag</div>
              </div>
            </div>
            {d.pct_alocado !== null && <BarraCompliance pct={d.pct_alocado} rotulo="alocado" />}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              Recursos com a tag presente mas <strong>vazia</strong> contam como &ldquo;sem esta tag&rdquo; — uma tag em
              branco não carrega informação de rateio. Mesmo critério da aba Conformidade.
            </div>
          </div>
        )}
      </div>

      {d && d.itens.length > 0 && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Custo por {d.chave}</span>
            <span className="badge">{fmtNum(d.itens.length)}</span>
          </div>
          <div style={{ padding: '4px 20px 16px' }}>
            {d.itens.map((it) => (
              <div key={it.valor} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 2 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.valor}>{it.valor}</span>
                  <span style={{ flexShrink: 0, fontWeight: 700 }}>
                    {fmtBRL(it.custo)} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({fmtPct(it.pct)})</span>
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: (maxCusto > 0 ? (it.custo / maxCusto) * 100 : 0) + '%', height: '100%', background: 'var(--accent)', opacity: 0.8 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {d && d.por_mes.length > 1 && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Alocação por mês</span></div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Mês</th><th style={{ textAlign: 'right' }}>Alocado</th><th style={{ textAlign: 'right' }}>Sem tag</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>% alocado</th></tr></thead>
              <tbody>
                {d.por_mes.map((m) => (
                  <tr key={m.mes}>
                    <td>{m.mes}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green,#22c55e)' }}>{fmtBRL(m.alocado)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--orange,#ff8c42)' }}>{fmtBRL(m.nao_alocado)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtBRL(m.total)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPct(m.pct_alocado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Conformidade ────────────────────────────────────────────────────────────
function ComplianceTab() {
  const queryClient = useQueryClient()
  const [sub, setSub] = useState('')
  const [editandoTags, setEditandoTags] = useState(false)
  const [rascunhoTags, setRascunhoTags] = useState('')

  const subsQuery = useQuery({ queryKey: ['calc-subscriptions'], queryFn: listSubscriptions })
  const q = useQuery({
    queryKey: ['azure-inv-tags-faltantes', sub],
    queryFn: () => getAzureTagsFaltantes(sub || undefined),
  })
  // Chaves realmente presentes no billing — alimenta o datalist, pra o admin escolher entre as
  // que existem em vez de digitar no escuro (e errar `Projeto` vs `projeto`, que são chaves
  // diferentes no dado real).
  const chavesQuery = useQuery({ queryKey: ['azure-tag-chaves'], queryFn: () => getAzureTagChaves() })
  // O valor ATUAL das tags obrigatórias vem daqui, não do relatório: `/config` responde na hora,
  // enquanto `/tags-faltantes` leva ~8s (varre o inventário inteiro). Esperar o relatório só pra
  // saber o que já está configurado deixaria o botão "Configurar" travado sem necessidade.
  const configQuery = useQuery({ queryKey: ['azure-inv-config'], queryFn: getAzureInventarioConfig })
  const chavesConfiguradas = (configQuery.data?.tags_obrigatorias || '')
    .split(',').map((x) => x.trim()).filter(Boolean)
  const rebuild = useMutation({
    mutationFn: rebuildAzureRecursoTags,
    onSuccess: (r) => window.showToast?.(r.message, 'success'),
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })
  const salvarTags = useMutation({
    mutationFn: () => salvarTagsObrigatorias(rascunhoTags),
    onSuccess: () => {
      window.showToast?.('Tags obrigatórias atualizadas.', 'success')
      setEditandoTags(false)
      queryClient.invalidateQueries({ queryKey: ['azure-inv-tags-faltantes'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-config'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar: ' + e.message, 'error'),
  })

  const d = q.data
  const semChaves = d && d.chaves.length === 0

  return (
    <>
      <div className="card" style={{ margin: '16px 20px' }}>
        <div className="card-header">
          <span className="card-title">Conformidade de Tags</span>
          <button
            className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }}
            disabled={rebuild.isPending}
            title="Reconstrói o cache de tags a partir do billing (leva alguns minutos, roda em background)"
            onClick={() => rebuild.mutate()}
          >
            {rebuild.isPending ? 'Iniciando...' : '↻ Atualizar cache de tags'}
          </button>
        </div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Recursos ativos do Inventário cujas tags obrigatórias estão faltando. As tags vêm do billing já
          coletado — zero coleta nova.
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">Todas as assinaturas</option>
            {subsQuery.data?.map((s) => (
              <option key={s.subscription_id} value={s.subscription_id}>{s.subscription_name || s.subscription_id}</option>
            ))}
          </select>
          {d?.atualizado_em && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Cache de tags: {fmtNum(d.recursos_conhecidos)} recursos &middot; atualizado {fmtData(d.atualizado_em)}
            </span>
          )}
        </div>

        {/* Editor inline das tags obrigatórias (2026-09-04, pedido do usuário) — mesmo dado que
            Inventário → Configuração, mas gravado por uma rota dedicada que altera só esta coluna,
            então as duas telas podem editar sem uma sobrescrever a configuração da outra. */}
        <div style={{ margin: '0 20px 12px', padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          {!editandoTags && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Tags obrigatórias:</span>
              {chavesConfiguradas.length > 0
                ? chavesConfiguradas.map((c) => (
                    <span key={c} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 10px', fontSize: 11 }}>{c}</span>
                  ))
                : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>nenhuma definida — a checagem está desativada</span>}
              <button
                className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }}
                // Desabilitado enquanto carrega: sem isso, clicar antes da resposta chegar abriria
                // o editor com `d` ainda undefined e o campo VAZIO — salvar dali apagaria as tags
                // já configuradas sem o usuário perceber.
                disabled={!configQuery.data}
                title={configQuery.data ? 'Editar as tags obrigatórias' : 'Carregando configuração atual...'}
                onClick={() => { setRascunhoTags(chavesConfiguradas.join(', ')); setEditandoTags(true) }}
              >
                ✎ Configurar
              </button>
            </div>
          )}

          {editandoTags && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Tags obrigatórias nos ambientes</div>
              <input
                list="chaves-tag-disponiveis"
                value={rascunhoTags}
                onChange={(e) => setRascunhoTags(e.target.value)}
                placeholder="ex: projeto, sigla, centroDeCusto"
                style={{ width: '100%' }}
                autoFocus
              />
              <datalist id="chaves-tag-disponiveis">
                {(chavesQuery.data?.chaves || []).map((c) => (
                  <option key={c.chave} value={c.chave}>{fmtNum(c.valores_distintos)} valores</option>
                ))}
              </datalist>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Separadas por vírgula. Todo recurso ativo precisa ter <strong>todas</strong> elas preenchidas para contar
                como conforme — tag presente mas vazia conta como faltando. Deixe em branco para desativar a checagem.
              </div>

              {(chavesQuery.data?.chaves.length ?? 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Chaves que existem no billing (clique para adicionar):
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 92, overflowY: 'auto' }}>
                    {chavesQuery.data!.chaves.slice(0, 30).map((c) => {
                      const jaTem = rascunhoTags.split(',').map((x) => x.trim()).includes(c.chave)
                      return (
                        <button
                          key={c.chave}
                          type="button"
                          title={fmtNum(c.valores_distintos) + ' valores distintos · ' + fmtBRL(c.custo) + ' com esta tag'}
                          onClick={() => {
                            const atuais = rascunhoTags.split(',').map((x) => x.trim()).filter(Boolean)
                            setRascunhoTags(jaTem ? atuais.filter((x) => x !== c.chave).join(', ') : [...atuais, c.chave].join(', '))
                          }}
                          style={{
                            cursor: 'pointer', fontSize: 11, borderRadius: 12, padding: '3px 10px',
                            border: '1px solid ' + (jaTem ? 'var(--accent)' : 'var(--border)'),
                            background: jaTem ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg)',
                            color: 'var(--text)',
                          }}
                        >
                          {jaTem ? '✓ ' : '+ '}{c.chave}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-primary" disabled={salvarTags.isPending} onClick={() => salvarTags.mutate()}>
                  {salvarTags.isPending ? 'Salvando...' : 'Salvar'}
                </button>
                <button className="btn-ghost" onClick={() => setEditandoTags(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {q.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

        {semChaves && (
          <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhuma tag obrigatória configurada — a checagem está desativada. Use <strong>Configurar</strong> acima
            para definir as chaves (ex: <code>projeto, sigla</code>).
          </div>
        )}

        {d && !semChaves && (
          <div style={{ padding: '0 20px 16px' }}>
            {d.pct_conformes !== null && <BarraCompliance pct={d.pct_conformes} />}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 12 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green,#22c55e)' }}>{fmtNum(d.conformes)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Conformes</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--red,#ff4d6a)' }}>{fmtNum(d.total_nao_conformes)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Não conformes</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtNum(d.verificaveis)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Verificáveis</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-muted)' }}>{fmtNum(d.nao_verificaveis)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Não verificáveis</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              &ldquo;Não verificáveis&rdquo; são recursos sem nenhuma linha de billing conhecida — não dá pra afirmar
              que faltam tags neles, então ficam fora do percentual (nunca contados como não-conformes).
            </div>
          </div>
        )}
      </div>

      {d && !semChaves && d.nao_conformes.length > 0 && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Recursos não conformes</span>
            <span className="badge">{fmtNum(d.total_nao_conformes)}</span>
          </div>
          {d.total_nao_conformes > d.nao_conformes.length && (
            <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
              Mostrando os primeiros {d.nao_conformes.length} de {fmtNum(d.total_nao_conformes)}.
            </div>
          )}
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Recurso</th><th>Tipo</th><th>Resource Group</th><th>Tags faltando</th></tr></thead>
              <tbody>
                {d.nao_conformes.map((r) => (
                  <tr key={r.resource_id}>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.resource_id}>
                      {r.nome || r.resource_id}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.resource_type || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.resource_group || '—'}</td>
                    <td>
                      {r.tags_faltando.map((t) => (
                        <span key={t} style={{ background: 'rgba(255,77,106,.12)', color: 'var(--red,#ff4d6a)', borderRadius: 10, padding: '2px 7px', marginRight: 4, fontSize: 11 }}>{t}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Previsão & Orçamento ────────────────────────────────────────────────────

// Abaixo disso a "tendência" é uma reta por 2-3 pontos — matematicamente válida,
// estatisticamente vazia. A UI avisa em vez de entregar um número falsamente preciso.
const MESES_MINIMOS_CONFIANCA = 4

const SEVERIDADE_INFO: Record<AzureOrcamentoSeveridade, { label: string; cor: string }> = {
  atencao: { label: 'Atenção', cor: 'var(--orange,#ff8c42)' },
  critico: { label: 'Crítico', cor: 'var(--red,#ff4d6a)' },
  estourado: { label: 'Estourado', cor: 'var(--red,#ff4d6a)' },
}

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesLabel(m: string): string {
  const [a, mm] = m.split('-')
  return MES_ABREV[Number(mm) - 1] + '/' + a.slice(2)
}

// Barras mensais com previsão hachurada — SVG inline, sem lib (mesma técnica do MonthlyBarChart
// do dashboard Databricks; copiado em vez de extraído porque aquele carrega split pago/free e
// drill-down específicos do Databricks, e mexer nele arriscaria uma tela já verificada).
// Hachura + borda tracejada, não só cor mais clara: "real vs. previsto" é distinção categórica,
// então quem não distingue a cor ainda vê a textura.
function GraficoPrevisao({ serie }: { serie: { mes: string; custo: number; previsto: boolean }[] }) {
  if (!serie.length) return null
  const W = 720, H = 220, PAD_TOP = 24, PAD_BOTTOM = 34, PAD_SIDE = 12
  const plotH = H - PAD_TOP - PAD_BOTTOM
  const max = Math.max(...serie.map((d) => d.custo), 1)
  const slot = (W - PAD_SIDE * 2) / serie.length
  const larg = Math.min(70, slot * 0.62)
  const baseY = H - PAD_BOTTOM
  const temPrevisao = serie.some((d) => d.previsto)
  return (
    <div style={{ padding: '0 20px 8px' }}>
      <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 240 }}>
        <defs>
          <pattern id="alocHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--accent)" opacity="0.18" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" strokeWidth="2.5" opacity="0.7" />
          </pattern>
        </defs>
        <line x1={PAD_SIDE} y1={baseY} x2={W - PAD_SIDE} y2={baseY} stroke="var(--border)" strokeWidth={1} />
        {serie.map((d, i) => {
          const h = (d.custo / max) * plotH
          const x = PAD_SIDE + i * slot + (slot - larg) / 2
          const y = baseY - h
          return (
            <g key={d.mes}>
              <rect
                x={x} y={y} width={larg} height={Math.max(1, h)} rx={3}
                fill={d.previsto ? 'url(#alocHatch)' : 'var(--accent)'}
                stroke={d.previsto ? 'var(--accent)' : 'none'}
                strokeDasharray={d.previsto ? '4 3' : undefined}
                opacity={d.previsto ? 1 : 0.85}
              >
                <title>{mesLabel(d.mes)}: {fmtBRL(d.custo)}{d.previsto ? ' (previsto)' : ''}</title>
              </rect>
              <text x={x + larg / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text)">
                {(d.custo / 1000).toFixed(0)}k
              </text>
              <text x={x + larg / 2} y={baseY + 14} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                {mesLabel(d.mes)}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', opacity: 0.85, borderRadius: 2, marginRight: 4 }} />
          Real
        </span>
        {temPrevisao && (
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 10, border: '1px dashed var(--accent)', borderRadius: 2, marginRight: 4 }} />
            Previsão (tendência linear)
          </span>
        )}
      </div>
    </div>
  )
}

function PrevisaoTab() {
  const queryClient = useQueryClient()
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<AzureOrcamentoInventario | null>(null)

  const serieQuery = useQuery({ queryKey: ['azure-serie-mensal'], queryFn: getAzureSerieMensal })
  const subsQuery = useQuery({ queryKey: ['calc-subscriptions'], queryFn: listSubscriptions })
  const orcQuery = useQuery({ queryKey: ['azure-inv-orcamentos'], queryFn: getAzureOrcamentosInventario })
  const alertasQuery = useQuery({ queryKey: ['azure-inv-orcamentos-alertas'], queryFn: getAzureOrcamentosInventarioAlertas })
  const excluir = useMutation({
    mutationFn: excluirAzureOrcamentoInventario,
    onSuccess: () => {
      window.showToast?.('Orçamento excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-orcamentos'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-orcamentos-alertas'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const porMes = serieQuery.data?.por_mes || []
  const dataFim = serieQuery.data?.ate || ''
  const completos = dataFim ? mesesCompletos(porMes, dataFim) : []
  const projecao = dataFim ? projecaoMesCorrente(porMes, dataFim) : null
  const serie = completos.length >= 2 ? forecastLinear(completos, 3) : completos.map((m) => ({ ...m, previsto: false }))

  const alertas = alertasQuery.data || []
  const orcamentos = orcQuery.data || []
  const nomeSub = (id: string) => subsQuery.data?.find((s) => s.subscription_id === id)?.subscription_name || id

  return (
    <>
      <div className="card" style={{ margin: '16px 20px' }}>
        <div className="card-header"><span className="card-title">Previsão de Custo</span></div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Tendência por regressão linear sobre os meses <strong>fechados</strong>. O mês corrente entra à parte, como
          projeção de run-rate — incluí-lo na regressão puxaria a reta pra baixo, já que ele está sempre incompleto.
        </div>

        {serieQuery.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

        {projecao && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, padding: '0 20px 12px' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtBRL(projecao.custo_mtd)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Mês corrente até agora ({projecao.dias_decorridos} de {projecao.dias_no_mes} dias)
              </div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{fmtBRL(projecao.projecao)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Projeção do mês fechado (run-rate)</div>
            </div>
          </div>
        )}

        {completos.length > 0 && completos.length < MESES_MINIMOS_CONFIANCA && (
          <div style={{ margin: '0 20px 12px', padding: 10, borderRadius: 6, fontSize: 12, background: 'color-mix(in srgb, var(--orange,#ff8c42) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--orange,#ff8c42) 40%, transparent)' }}>
            Apenas <strong>{completos.length}</strong> {completos.length === 1 ? 'mês fechado' : 'meses fechados'} de
            histórico — a tendência é matematicamente válida mas estatisticamente pouco confiável. Ela fica útil a
            partir de {MESES_MINIMOS_CONFIANCA} meses.
          </div>
        )}

        <GraficoPrevisao serie={serie} />
      </div>

      {alertas.length > 0 && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Orçamentos em alerta</span><span className="badge">{alertas.length}</span></div>
          <div style={{ padding: '4px 20px 16px', display: 'grid', gap: 8 }}>
            {alertas.map((a) => {
              const info = SEVERIDADE_INFO[a.severidade]
              return (
                <div key={a.orcamento.id} style={{
                  padding: 10, borderRadius: 6, fontSize: 12,
                  background: 'color-mix(in srgb, ' + info.cor + ' 12%, transparent)',
                  border: '1px solid color-mix(in srgb, ' + info.cor + ' 40%, transparent)',
                }}>
                  <strong style={{ color: info.cor }}>{info.label}</strong> — {a.orcamento.nome}: {fmtPct(a.pct)} do limite
                  {' '}({a.orcamento.tipo_limite === 'custo' ? fmtBRL(a.valor_atual) : fmtNum(a.valor_atual) + ' recursos'} de{' '}
                  {a.orcamento.tipo_limite === 'custo' ? fmtBRL(a.orcamento.limite_valor) : fmtNum(a.orcamento.limite_valor) + ' recursos'})
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ margin: '16px 20px' }}>
        <div className="card-header">
          <span className="card-title">Orçamentos</span>
          {orcQuery.data && <span className="badge">{orcamentos.length}</span>}
          <button className="btn-primary" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => { setEditando(null); setModalAberto(true) }}>
            + Novo orçamento
          </button>
        </div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Teto por assinatura ou Resource Group, em contagem de recursos ativos ou custo do mês. Dispara alerta por
          e-mail nos thresholds configurados.
        </div>
        {orcamentos.length === 0 && !orcQuery.isLoading && (
          <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum orçamento cadastrado.</div>
        )}
        {orcamentos.length > 0 && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Nome</th><th>Escopo</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Limite</th><th>Alerta / Crítico</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {orcamentos.map((o) => (
                  <tr key={o.id}>
                    <td>{o.nome}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {o.escopo_tipo === 'tag'
                        ? `${o.tag_chave} = ${o.tag_valor}` + (o.subscription_id ? ` · ${nomeSub(o.subscription_id)}` : ' · todas')
                        : o.escopo_tipo === 'resource_group' ? o.resource_group : nomeSub(o.subscription_id)}
                    </td>
                    <td style={{ fontSize: 12 }}>{o.tipo_limite === 'custo' ? 'Custo do mês' : 'Recursos ativos'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {o.tipo_limite === 'custo' ? fmtBRL(o.limite_valor) : fmtNum(o.limite_valor)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.threshold_atencao}% / {o.threshold_critico}%</td>
                    <td>
                      {o.ativo
                        ? <span style={{ color: 'var(--green,#22c55e)', fontSize: 11 }}>● Ativo</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>○ Inativo</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => { setEditando(o); setModalAberto(true) }}>Editar</button>
                      <button
                        className="btn-ghost" style={{ fontSize: 11, color: 'var(--red,#ff4d6a)' }}
                        onClick={() => { if (window.confirm('Excluir o orçamento "' + o.nome + '"?')) excluir.mutate(o.id) }}
                      >Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalAberto && (
        <InventarioOrcamentoModal
          orcamento={editando}
          subscriptions={(subsQuery.data || []).map((s) => ({ subscription_id: s.subscription_id, subscription_name: s.subscription_name }))}
          onClose={() => setModalAberto(false)}
        />
      )}
    </>
  )
}

// ── Cobertura de Commitment (Rate Optimization) ─────────────────────────────

// Benchmark de mercado para organizações maduras: 60–80% da base ELEGÍVEL coberta por
// Reservation/Savings Plan. Abaixo disso há economia deixada na mesa.
const BENCHMARK_COBERTURA = 0.6

const fmtHoras = (v: number) => Math.round(v).toLocaleString('pt-BR') + ' h'

function ReservasTab() {
  const [sub, setSub] = useState('')
  const subsQuery = useQuery({ queryKey: ['calc-subscriptions'], queryFn: listSubscriptions })
  const q = useQuery({
    queryKey: ['azure-commitment-cobertura', sub],
    queryFn: () => getAzureCommitmentCobertura(sub || undefined),
  })

  const d = q.data
  const t = d?.total

  return (
    <>
      <div className="card" style={{ margin: '16px 20px' }}>
        <div className="card-header"><span className="card-title">Cobertura de Compromisso (RI / Savings Plan)</span></div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Quanto do consumo de VM está coberto por Reserva ou Savings Plan. Medido em <strong>horas</strong>, não em
          R$ — neste export de billing as linhas cobertas vêm com custo e valor de lista zerados, então um percentual
          em dinheiro daria 0% e seria enganoso. Horas é também a unidade canônica de coverage em FinOps.
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">Todas as assinaturas</option>
            {subsQuery.data?.map((s) => (
              <option key={s.subscription_id} value={s.subscription_id}>{s.subscription_name || s.subscription_id}</option>
            ))}
          </select>
          {d?.atualizado_em && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Rollup atualizado {fmtData(d.atualizado_em)}</span>
          )}
        </div>

        {q.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

        {d && !d.determinavel && (
          <div style={{ margin: '0 20px 16px', padding: 12, borderRadius: 6, fontSize: 12, background: 'color-mix(in srgb, var(--orange,#ff8c42) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--orange,#ff8c42) 40%, transparent)' }}>
            Cobertura ainda não calculada — o rollup mensal não foi construído. Use <strong>Reconstruir rollup</strong>
            na aba <strong>Rateio por Tag</strong>. Um &ldquo;0%&rdquo; aqui seria lido como &ldquo;não temos nenhuma
            reserva&rdquo;, o que não é a mesma coisa que &ldquo;ainda não medimos&rdquo;.
          </div>
        )}

        {d && d.determinavel && t && (
          <div style={{ padding: '0 20px 16px' }}>
            {t.cobertura_elegivel !== null && (
              <BarraCompliance pct={t.cobertura_elegivel} rotulo="coberto (base elegível)" benchmark={BENCHMARK_COBERTURA} />
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtHoras(t.horas_total)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Horas de VM no período</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green,#22c55e)' }}>{fmtHoras(t.horas_cobertas)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Cobertas — RI {fmtHoras(t.horas_reservation)} + SP {fmtHoras(t.horas_savingsplan)}
                </div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-muted)' }}>{fmtHoras(t.horas_spot)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Spot (não elegível a commitment)</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--orange,#ff8c42)' }}>
                  {fmtHoras(t.horas_elegiveis - t.horas_cobertas)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Elegíveis sem cobertura</div>
              </div>
            </div>

            {d.desconto_ondemand.pct !== null && (
              <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  Desconto sobre On-Demand: {fmtPct(d.desconto_ondemand.pct)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {fmtBRL(d.desconto_ondemand.custo_lista)} de preço de lista → {fmtBRL(d.desconto_ondemand.custo_efetivo)} efetivo.
                  Este é o desconto <strong>negociado no contrato</strong> (EA/MCA), <strong>não</strong> economia de
                  reserva — e por isso não é o &ldquo;Effective Savings Rate&rdquo;. {d.esr_commitment.motivo}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {d && d.determinavel && d.por_mes.length > 0 && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Cobertura por mês</span></div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th style={{ textAlign: 'right' }}>Horas de VM</th>
                  <th style={{ textAlign: 'right' }}>Reserva</th>
                  <th style={{ textAlign: 'right' }}>Savings Plan</th>
                  <th style={{ textAlign: 'right' }}>Spot</th>
                  <th style={{ textAlign: 'right' }}>Cobertura (elegível)</th>
                </tr>
              </thead>
              <tbody>
                {d.por_mes.map((m) => (
                  <tr key={m.mes}>
                    <td>{m.mes}</td>
                    <td style={{ textAlign: 'right' }}>{fmtHoras(m.horas_total)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtHoras(m.horas_reservation)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtHoras(m.horas_savingsplan)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtHoras(m.horas_spot)}</td>
                    <td style={{
                      textAlign: 'right', fontWeight: 700,
                      color: (m.cobertura_elegivel ?? 0) >= BENCHMARK_COBERTURA ? 'var(--green,#22c55e)' : 'var(--orange,#ff8c42)',
                    }}>
                      {fmtPct(m.cobertura_elegivel)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

const TABS = [
  { id: 'showback', label: 'Rateio por Tag' },
  { id: 'compliance', label: 'Conformidade' },
  { id: 'previsao', label: 'Previsão & Orçamento' },
  { id: 'reservas', label: 'Cobertura RI/SP' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function AlocacaoView() {
  const [tab, setTab] = useState<TabId>('showback')
  return (
    <div className="view active">
      <div className="view-hero">
        <div className="page-title">Alocação &amp; Otimização</div>
        <div className="view-hero-sub">Rateio de custo por tag, conformidade, previsão e cobertura de compromisso</div>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '16px 20px 0' }}>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'showback' && <ShowbackTab />}
      {tab === 'compliance' && <ComplianceTab />}
      {tab === 'previsao' && <PrevisaoTab />}
      {tab === 'reservas' && <ReservasTab />}
    </div>
  )
}

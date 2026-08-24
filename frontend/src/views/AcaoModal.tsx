import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import MonthGrid, { type MonthValues } from '../components/MonthGrid'
import { createAcao, deleteAcao, updateAcao } from '../api/acoes'
import { listProjetos } from '../api/projetos'
import { listUsuarios } from '../api/usuarios'
import { CLOUDS, MESES, STATUS_OPTIONS, TIPO_ACAO_OPTIONS } from '../config/acaoOptions'
import type { Acao, AcaoInput } from '../types/acao'

interface FormState {
  id_finops: string
  projeto_id: string
  acao: string
  cloud: string
  responsavel: string
  tipo_acao: string
  impacto_atual_mes: string
  status: string
  data_inicio: string
  data_conclusao: string
  atual: MonthValues
  proximo: MonthValues
}

function emptyMonths(): MonthValues {
  const m: MonthValues = {}
  MESES.forEach((mes) => { m[mes.abbrev] = '' })
  return m
}

function emptyForm(): FormState {
  return {
    id_finops: '', projeto_id: '', acao: '', cloud: '', responsavel: '', tipo_acao: '',
    impacto_atual_mes: '', status: '', data_inicio: '', data_conclusao: '',
    atual: emptyMonths(), proximo: emptyMonths(),
  }
}

function fromAcao(a: Acao): FormState {
  const atual: MonthValues = {}
  const proximo: MonthValues = {}
  MESES.forEach((m) => {
    const va = (a as unknown as Record<string, number>)['atual_' + m.key]
    const vp = (a as unknown as Record<string, number>)['proximo_' + m.key]
    atual[m.abbrev] = va ? String(va) : ''
    proximo[m.abbrev] = vp ? String(vp) : ''
  })
  return {
    id_finops: a.id_finops || '',
    projeto_id: a.projeto_id != null ? String(a.projeto_id) : '',
    acao: a.acao || '',
    cloud: a.cloud || '',
    responsavel: a.responsavel || '',
    tipo_acao: a.tipo_acao || '',
    impacto_atual_mes: a.impacto_atual_mes ? String(a.impacto_atual_mes) : '',
    status: a.status || '',
    data_inicio: a.data_inicio ? a.data_inicio.split('T')[0] : '',
    data_conclusao: a.data_conclusao ? a.data_conclusao.split('T')[0] : '',
    atual, proximo,
  }
}

interface AcaoModalProps {
  acao: Acao | null
  onClose: () => void
}

export default function AcaoModal({ acao, onClose }: AcaoModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (acao ? fromAcao(acao) : emptyForm()))

  const projetosQuery = useQuery({ queryKey: ['projetos'], queryFn: listProjetos })
  const usuariosQuery = useQuery({ queryKey: ['usuarios'], queryFn: listUsuarios })
  const responsaveis = (usuariosQuery.data || []).filter((u) => u.ativo)

  const saveMutation = useMutation({
    mutationFn: (input: AcaoInput) => (acao ? updateAcao(acao.id, input) : createAcao(input)),
    onSuccess: () => {
      window.showToast?.('Ação salva com sucesso!', 'success')
      queryClient.invalidateQueries({ queryKey: ['acoes'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar ação: ' + e.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAcao(id),
    onSuccess: () => {
      window.showToast?.('Ação excluída.', 'success')
      queryClient.invalidateQueries({ queryKey: ['acoes'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir ação: ' + e.message, 'error'),
  })

  function handleDelete() {
    if (!acao) return
    if (!confirm(`Excluir a ação "${acao.acao}"? Esta ação não pode ser desfeita.`)) return
    deleteMutation.mutate(acao.id)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.acao || !form.status) {
      window.showToast?.('Preencha ao menos Ação e Status.', 'error')
      return
    }
    // Os totais NÃO são recalculados pelo servidor — precisam ser somados
    // aqui, exatamente como submitAcao() fazia (app.js).
    let retorno_ano_atual = 0
    let retorno_proximo_ano = 0
    const monthFields: Record<string, number> = {}
    MESES.forEach((m) => {
      const va = parseFloat(form.atual[m.abbrev]) || 0
      const vp = parseFloat(form.proximo[m.abbrev]) || 0
      monthFields['atual_' + m.key] = va
      monthFields['proximo_' + m.key] = vp
      retorno_ano_atual += va
      retorno_proximo_ano += vp
    })

    const input = {
      id_finops: form.id_finops || undefined,
      projeto_id: form.projeto_id ? parseInt(form.projeto_id, 10) : null,
      acao: form.acao,
      cloud: form.cloud || null,
      responsavel: form.responsavel || null,
      tipo_acao: form.tipo_acao || null,
      impacto_atual_mes: parseFloat(form.impacto_atual_mes) || 0,
      status: form.status,
      data_inicio: form.data_inicio || null,
      data_conclusao: form.data_conclusao || null,
      retorno_ano_atual,
      retorno_proximo_ano,
      ...monthFields,
    } as unknown as AcaoInput

    saveMutation.mutate(input)
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span>{acao ? 'Editar Ação FinOps' : 'Nova Ação FinOps'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form id="acao-form" onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="acao-id-finops">ID FinOps</label>
                <input id="acao-id-finops" type="text" readOnly value={form.id_finops} placeholder="Gerado ao salvar" />
              </div>
              <div className="form-group">
                <label htmlFor="acao-projeto">Projeto</label>
                <select id="acao-projeto" value={form.projeto_id} onChange={(e) => setForm({ ...form, projeto_id: e.target.value })}>
                  <option value="">Selecione...</option>
                  {(projetosQuery.data || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="acao-nome">Ação *</label>
                <input
                  id="acao-nome" type="text" required
                  value={form.acao}
                  onChange={(e) => setForm({ ...form, acao: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="acao-cloud">Cloud</label>
                <select id="acao-cloud" value={form.cloud} onChange={(e) => setForm({ ...form, cloud: e.target.value })}>
                  <option value="">Selecione...</option>
                  {CLOUDS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="acao-responsavel">Responsável</label>
                <select id="acao-responsavel" value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })}>
                  <option value="">Selecione...</option>
                  {responsaveis.map((u) => (
                    <option key={u.id} value={u.nome}>{u.nome}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="acao-tipo">Tipo de Ação</label>
                <select id="acao-tipo" value={form.tipo_acao} onChange={(e) => setForm({ ...form, tipo_acao: e.target.value })}>
                  <option value="">Selecione...</option>
                  {TIPO_ACAO_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="acao-impacto">Impacto Atual (Mês) R$</label>
                <input
                  id="acao-impacto" type="number" step="0.01" placeholder="0,00"
                  value={form.impacto_atual_mes}
                  onChange={(e) => setForm({ ...form, impacto_atual_mes: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="acao-status">Status *</label>
                <select id="acao-status" required value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="">Selecione...</option>
                  {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="acao-data-inicio">Data de Início</label>
                <input
                  id="acao-data-inicio" type="date"
                  value={form.data_inicio}
                  onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="acao-data-conclusao">Data de Conclusão</label>
                <input
                  id="acao-data-conclusao" type="date"
                  value={form.data_conclusao}
                  onChange={(e) => setForm({ ...form, data_conclusao: e.target.value })}
                />
              </div>
            </div>

            <MonthGrid
              title="Retorno Ano Atual (R$)"
              values={form.atual}
              onChange={(abbrev, value) => setForm((f) => ({ ...f, atual: { ...f.atual, [abbrev]: value } }))}
              onBulkChange={(patch) => setForm((f) => ({ ...f, atual: { ...f.atual, ...patch } }))}
            />
            <MonthGrid
              title="Retorno Próximo Ano (R$)"
              values={form.proximo}
              onChange={(abbrev, value) => setForm((f) => ({ ...f, proximo: { ...f.proximo, [abbrev]: value } }))}
              onBulkChange={(patch) => setForm((f) => ({ ...f, proximo: { ...f.proximo, ...patch } }))}
            />
          </form>
        </div>
        <div className="modal-footer">
          {acao && (
            <button
              className="btn-ghost"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)', marginRight: 'auto' }}
              onClick={handleDelete}
            >
              Excluir
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="acao-form" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

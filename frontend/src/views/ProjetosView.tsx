import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createProjeto, deleteProjeto, listProjetos, updateProjeto } from '../api/projetos'
import type { Projeto, ProjetoInput } from '../types/projeto'

const EMPTY_FORM: ProjetoInput = { nome: '', diretoria: '', descricao: '' }

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

export default function ProjetosView() {
  const queryClient = useQueryClient()
  const { data: projetos, isLoading, isError, error } = useQuery({
    queryKey: ['projetos'],
    queryFn: listProjetos,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Projeto | null>(null)
  const [form, setForm] = useState<ProjetoInput>(EMPTY_FORM)

  const invalidateAndClose = () => {
    queryClient.invalidateQueries({ queryKey: ['projetos'] })
    setModalOpen(false)
  }

  const saveMutation = useMutation({
    mutationFn: (input: ProjetoInput) =>
      editing ? updateProjeto(editing.id, input) : createProjeto(input),
    onSuccess: () => {
      window.showToast?.('Projeto salvo com sucesso!', 'success')
      invalidateAndClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar projeto: ' + e.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProjeto(id),
    onSuccess: () => {
      window.showToast?.('Projeto excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['projetos'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir projeto: ' + e.message, 'error'),
  })

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(p: Projeto) {
    setEditing(p)
    setForm({ nome: p.nome, diretoria: p.diretoria || '', descricao: p.descricao || '' })
    setModalOpen(true)
  }

  function handleDelete(p: Projeto) {
    if (!confirm(`Excluir o projeto "${p.nome}"? Esta ação não pode ser desfeita.`)) return
    deleteMutation.mutate(p.id)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    saveMutation.mutate(form)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn-primary" onClick={openNew}>
          Novo Projeto
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Projetos Cadastrados</span>
          <span className="badge">{projetos?.length ?? 0}</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nome do Projeto</th>
                <th>Diretoria</th>
                <th>Descrição</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="empty-state">Carregando...</td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Erro ao carregar projetos: {(error as Error).message}
                  </td>
                </tr>
              )}
              {!isLoading && !isError && projetos?.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">Nenhum projeto cadastrado</td>
                </tr>
              )}
              {projetos?.map((p) => (
                <tr key={p.id}>
                  <td><span className="finops-id">#{p.id}</span></td>
                  <td><strong>{p.nome}</strong></td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.diretoria || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.descricao || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(p.criado_em)}</td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-icon" title="Editar" onClick={() => openEdit(p)}>
                        <svg viewBox="0 0 16 16" fill="none">
                          <path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button className="btn-icon delete" title="Excluir" onClick={() => handleDelete(p)}>
                        <svg viewBox="0 0 16 16" fill="none">
                          <path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <div className="modal">
            <div className="modal-header">
              <span>{editing ? 'Editar Projeto' : 'Novo Projeto'}</span>
              <button className="modal-close" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="projeto-nome">Nome do Projeto *</label>
                  <input
                    id="projeto-nome"
                    type="text"
                    required
                    placeholder="Ex: Otimização de Instâncias EC2"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="projeto-diretoria">Diretoria</label>
                  <input
                    id="projeto-diretoria"
                    type="text"
                    placeholder="Ex: Tecnologia, Infraestrutura..."
                    value={form.diretoria}
                    onChange={(e) => setForm({ ...form, diretoria: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="projeto-descricao">Descrição</label>
                  <textarea
                    id="projeto-descricao"
                    rows={3}
                    placeholder="Descreva o projeto..."
                    value={form.descricao}
                    onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Salvando...' : 'Salvar Projeto'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

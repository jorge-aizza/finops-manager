import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { atualizarGrupo, baixarModeloImportacaoMailing, criarGrupo, excluirGrupo, importarContatosGrupo, listContatos, listGrupos } from '../api/mailing'
import type { MailingContato, MailingGrupo, MailingGrupoInput } from '../types/mailing'

export default function MailingGrupos() {
  const queryClient = useQueryClient()
  const [editando, setEditando] = useState<MailingGrupo | 'novo' | null>(null)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const grupoImportacaoRef = useRef<MailingGrupo | null>(null)
  const gruposQuery = useQuery({ queryKey: ['mailing-grupos'], queryFn: listGrupos })
  const salvarMutation = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: MailingGrupoInput }) =>
      id === null ? criarGrupo(input) : atualizarGrupo(id, input),
    onSuccess: () => {
      window.showToast?.('Grupo salvo.', 'success')
      setEditando(null)
      queryClient.invalidateQueries({ queryKey: ['mailing-grupos'] })
    },
    onError: (error: Error) => window.showToast?.('Erro ao salvar grupo: ' + error.message, 'error'),
  })
  const excluirMutation = useMutation({
    mutationFn: excluirGrupo,
    onSuccess: () => {
      window.showToast?.('Grupo excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-grupos'] })
    },
    onError: (error: Error) => window.showToast?.('Erro ao excluir grupo: ' + error.message, 'error'),
  })
  const importarMutation = useMutation({
    mutationFn: ({ grupo, file }: { grupo: MailingGrupo; file: File }) => importarContatosGrupo(grupo.id, file),
    onSuccess: (resultado) => {
      window.showToast?.(
        `Importação concluída: ${resultado.associados} contato(s) no grupo; ${resultado.novos} novo(s), ${resultado.atualizados} atualizado(s), ${resultado.invalidos} inválido(s).`,
        resultado.invalidos ? 'warn' : 'success',
      )
      queryClient.invalidateQueries({ queryKey: ['mailing-grupos'] })
      queryClient.invalidateQueries({ queryKey: ['mailing-contatos'] })
      queryClient.invalidateQueries({ queryKey: ['mailing-contatos-grupos'] })
      queryClient.invalidateQueries({ queryKey: ['mailing-contatos-envio'] })
    },
    onError: (error: Error) => window.showToast?.('Erro ao importar grupo: ' + error.message, 'error'),
  })
  const grupos = gruposQuery.data || []

  async function baixarModelo() {
    try {
      await baixarModeloImportacaoMailing()
    } catch (error) {
      window.showToast?.('Erro ao baixar modelo: ' + (error as Error).message, 'error')
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span className="card-title">Grupos de destinatários</span>
        <span className="badge">{grupos.length}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto' }}>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={baixarModelo}>
            Baixar modelo Excel
          </button>
          <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setEditando('novo')}>
            + Novo grupo
          </button>
        </div>
      </div>
      <input
        ref={arquivoRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Arquivo CSV ou Excel do grupo"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          const grupo = grupoImportacaoRef.current
          if (file && grupo) importarMutation.mutate({ grupo, file })
          event.currentTarget.value = ''
        }}
      />
      <div className="table-wrapper">
        <table className="data-table">
          <thead><tr><th>Grupo</th><th>Contatos</th><th>Ações</th></tr></thead>
          <tbody>
            {gruposQuery.isLoading && <tr><td colSpan={3} className="empty-state">Carregando...</td></tr>}
            {!gruposQuery.isLoading && grupos.length === 0 && <tr><td colSpan={3} className="empty-state">Nenhum grupo cadastrado.</td></tr>}
            {grupos.map((grupo) => (
              <tr key={grupo.id}>
                <td>
                  <strong>{grupo.nome}</strong>
                  {grupo.descricao && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{grupo.descricao}</div>}
                </td>
                <td>{grupo.total_contatos}</td>
                <td>
                  <div className="table-actions">
                    <button className="btn-icon" title="Importar CSV/Excel para o grupo" disabled={importarMutation.isPending} onClick={() => {
                      grupoImportacaoRef.current = grupo
                      arquivoRef.current?.click()
                    }}>⇧</button>
                    <button className="btn-icon" title="Editar grupo" onClick={() => setEditando(grupo)}>✎</button>
                    <button className="btn-icon delete" title="Excluir grupo" onClick={() => {
                      if (confirm(`Excluir o grupo "${grupo.nome}"? Os contatos não serão excluídos.`)) excluirMutation.mutate(grupo.id)
                    }}>×</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando !== null && (
        <GrupoEditor
          key={editando === 'novo' ? 'novo' : editando.id}
          grupo={editando === 'novo' ? null : editando}
          salvando={salvarMutation.isPending}
          onClose={() => setEditando(null)}
          onSave={(input) => salvarMutation.mutate({ id: editando === 'novo' ? null : editando.id, input })}
        />
      )}
    </div>
  )
}

function GrupoEditor({
  grupo, salvando, onClose, onSave,
}: {
  grupo: MailingGrupo | null
  salvando: boolean
  onClose: () => void
  onSave: (input: MailingGrupoInput) => void
}) {
  const contatosQuery = useQuery({ queryKey: ['mailing-contatos-grupos'], queryFn: () => listContatos() })
  const [nome, setNome] = useState(grupo?.nome || '')
  const [descricao, setDescricao] = useState(grupo?.descricao || '')
  const [busca, setBusca] = useState('')
  const [selecionados, setSelecionados] = useState<number[]>(grupo?.contato_ids || [])
  const contatos = contatosQuery.data || []
  const filtrados = contatos.filter((contato) =>
    `${contato.nome || ''} ${contato.email}`.toLowerCase().includes(busca.trim().toLowerCase()),
  )

  function alternarContato(contato: MailingContato) {
    setSelecionados((atuais) => atuais.includes(contato.id)
      ? atuais.filter((id) => id !== contato.id)
      : [...atuais, contato.id])
  }

  return (
    <div className="modal-overlay open" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" style={{ maxWidth: 620, width: '94vw' }} onSubmit={(event) => {
        event.preventDefault()
        if (!nome.trim()) return
        onSave({ nome: nome.trim(), descricao: descricao.trim() || null, contato_ids: selecionados })
      }}>
        <div className="modal-header">
          <span>{grupo ? 'Editar grupo' : 'Novo grupo'}</span>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="mailing-grupo-nome">Nome *</label>
            <input id="mailing-grupo-nome" autoFocus value={nome} onChange={(event) => setNome(event.target.value)} maxLength={160} />
          </div>
          <div className="form-group">
            <label htmlFor="mailing-grupo-descricao">Descrição</label>
            <input id="mailing-grupo-descricao" value={descricao} onChange={(event) => setDescricao(event.target.value)} maxLength={500} />
          </div>
          <div className="form-group">
            <label htmlFor="mailing-grupo-busca">Membros ({selecionados.length})</label>
            <input id="mailing-grupo-busca" type="search" placeholder="Buscar por nome ou e-mail..." value={busca} onChange={(event) => setBusca(event.target.value)} />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {contatosQuery.isLoading && <div style={{ padding: 12, color: 'var(--text-muted)' }}>Carregando contatos...</div>}
            {!contatosQuery.isLoading && filtrados.length === 0 && <div style={{ padding: 12, color: 'var(--text-muted)' }}>Nenhum contato encontrado.</div>}
            {filtrados.map((contato) => (
              <label key={contato.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selecionados.includes(contato.id)} onChange={() => alternarContato(contato)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contato.nome || contato.email}</span>
                  {contato.nome && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{contato.email}</span>}
                </span>
                {contato.status === 'opt_out' && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Descadastrado</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={!nome.trim() || salvando || contatosQuery.isLoading}>
            {salvando ? 'Salvando...' : 'Salvar grupo'}
          </button>
        </div>
      </form>
    </div>
  )
}
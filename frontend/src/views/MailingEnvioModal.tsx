import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import CmsMultiSelect from '../components/CmsMultiSelect'
import { listContatos, listGrupos } from '../api/mailing'
import type { MailingCampanha, MailingContato, MailingSelecaoDestinatarios } from '../types/mailing'

export default function MailingEnvioModal({
  campanha, enviando, onClose, onEnviar,
}: {
  campanha: MailingCampanha
  enviando: boolean
  onClose: () => void
  onEnviar: (selecao: MailingSelecaoDestinatarios) => void
}) {
  const [grupoIds, setGrupoIds] = useState<number[]>(() => campanha.destinatarios?.grupo_ids || [])
  const [contatoIds, setContatoIds] = useState<number[]>(() => campanha.destinatarios?.contato_ids || [])
  const [emails, setEmails] = useState<string[]>(() => campanha.destinatarios?.emails || [])
  const [todosAtivos, setTodosAtivos] = useState(campanha.destinatarios?.todos_ativos === true)
  const [busca, setBusca] = useState('')
  const gruposQuery = useQuery({ queryKey: ['mailing-grupos'], queryFn: listGrupos })
  const contatosQuery = useQuery({ queryKey: ['mailing-contatos-envio'], queryFn: () => listContatos() })
  const grupos = gruposQuery.data || []
  const contatos = contatosQuery.data || []
  const ativos = contatos.filter((contato) => contato.status === 'ativo')
  const ativosPorId = useMemo(() => new Map(ativos.map((contato) => [contato.id, contato])), [ativos])
  const contatosPorEmail = useMemo(() => new Map(contatos.map((contato) => [contato.email.trim().toLowerCase(), contato])), [contatos])
  const escolhidos = useMemo(() => {
    if (todosAtivos) return ativos.length
    const emailsUnicos = new Set<string>()
    contatoIds.forEach((id) => {
      const contato = ativosPorId.get(id)
      if (contato) emailsUnicos.add(contato.email.trim().toLowerCase())
    })
    grupos.filter((grupo) => grupoIds.includes(grupo.id)).forEach((grupo) => grupo.contato_ids.forEach((id) => {
      const contato = ativosPorId.get(id)
      if (contato) emailsUnicos.add(contato.email.trim().toLowerCase())
    }))
    emails.forEach((email) => {
      const normalizado = email.trim().toLowerCase()
      const contato = contatosPorEmail.get(normalizado)
      if (!contato || contato.status === 'ativo') emailsUnicos.add(normalizado)
    })
    return emailsUnicos.size
  }, [ativos.length, ativosPorId, contatoIds, contatosPorEmail, emails, grupoIds, grupos, todosAtivos])
  const contatosVisiveis = ativos.filter((contato) =>
    `${contato.nome || ''} ${contato.email}`.toLowerCase().includes(busca.trim().toLowerCase()),
  )
  const carregando = gruposQuery.isLoading || contatosQuery.isLoading

  function alternarContato(contato: MailingContato) {
    setTodosAtivos(false)
    setContatoIds((atuais) => atuais.includes(contato.id) ? atuais.filter((id) => id !== contato.id) : [...atuais, contato.id])
  }

  function removerEmail(email: string) {
    setEmails((atuais) => atuais.filter((atual) => atual !== email))
  }

  return (
    <div className="modal-overlay open" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 760, width: '94vw' }}>
        <div className="modal-header">
          <span>Destinatários — {campanha.assunto}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '11px 14px', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16, cursor: 'pointer', background: 'var(--bg-card)' }}>
            <input type="checkbox" checked={todosAtivos} onChange={(event) => {
              setTodosAtivos(event.target.checked)
              if (event.target.checked) { setGrupoIds([]); setContatoIds([]); setEmails([]) }
            }} />
            <span><strong>Todos os contatos ativos</strong><span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{ativos.length} contato(s); descadastrados serão excluídos.</span></span>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 20 }}>
            <section>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Grupos</div>
              <CmsMultiSelect
                values={grupoIds.map(String)}
                options={grupos.map((grupo) => ({
                  value: String(grupo.id),
                  label: grupo.nome,
                  sublabel: `${new Set(grupo.contato_ids.filter((id) => ativosPorId.has(id))).size} ativos`,
                }))}
                searchPlaceholder="Buscar grupo..."
                triggerLabel={grupoIds.length ? `${grupoIds.length} grupo(s) selecionado(s)` : `Selecionar grupo(s) · ${grupos.length}`}
                loading={gruposQuery.isLoading}
                emptyState="Nenhum grupo cadastrado."
                onChange={(values) => {
                  setTodosAtivos(false)
                  setGrupoIds(values.map(Number))
                }}
              />
            </section>

            <section>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Contatos individuais</div>
              <input
                className="filter-input"
                type="search"
                aria-label="Buscar contatos"
                placeholder="Buscar por nome ou e-mail..."
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                disabled={todosAtivos}
                style={{ display: 'block', width: '100%', minWidth: 0, height: 36, boxSizing: 'border-box', marginBottom: 8 }}
              />
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)' }}>
                {contatosQuery.isLoading && <div style={{ padding: 10, color: 'var(--text-muted)' }}>Carregando contatos...</div>}
                {!contatosQuery.isLoading && contatosVisiveis.length === 0 && <div style={{ padding: 10, color: 'var(--text-muted)' }}>Nenhum contato ativo encontrado.</div>}
                {contatosVisiveis.map((contato) => (
                  <label key={contato.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border)', cursor: todosAtivos ? 'default' : 'pointer' }}>
                    <input type="checkbox" checked={todosAtivos || contatoIds.includes(contato.id)} disabled={todosAtivos} onChange={() => alternarContato(contato)} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contato.nome || contato.email}</span>
                      {contato.nome && <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>{contato.email}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          </div>
          {emails.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {emails.map((email) => {
                const contato = contatosPorEmail.get(email.trim().toLowerCase())
                const elegivel = !contato || contato.status === 'ativo'
                return (
                  <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 5, padding: '4px 7px', fontSize: 11, opacity: elegivel ? 1 : 0.6 }}>
                    {email}{!elegivel && ' (descadastrado)'}
                    <button className="btn-icon" title={`Remover ${email}`} onClick={() => removerEmail(email)}>×</button>
                  </span>
                )
              })}
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: escolhidos ? 'var(--text)' : 'var(--danger)' }}>
            {carregando ? 'Carregando opções...' : `${escolhidos} destinatário(s) ativo(s), sem duplicidade`}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={carregando || escolhidos === 0 || enviando} onClick={() => onEnviar({
            grupo_ids: grupoIds, contato_ids: contatoIds, emails, todos_ativos: todosAtivos,
          })}>
            {enviando ? 'Iniciando...' : `Enviar para ${escolhidos}`}
          </button>
        </div>
      </div>
    </div>
  )
}
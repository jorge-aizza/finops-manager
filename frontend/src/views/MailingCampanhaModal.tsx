import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { atualizarCampanha, criarCampanha, enviarTesteCampanha } from '../api/mailing'
import type { MailingCampanha } from '../types/mailing'
import MailingComposer from '../components/MailingComposer'
import { buildTemplatePadraoFinOps } from '../lib/mailingTemplatePadrao'

interface MailingCampanhaModalProps {
  campanha: MailingCampanha | null // null = nova
  onClose: () => void
}

// Só edita campanhas em rascunho — depois de "Enviar" a campanha vira histórico
// (ver painel de acompanhamento em MailingView), não dá pra voltar e mudar o texto
// de um comunicado que já saiu pra parte dos destinatários.
export default function MailingCampanhaModal({ campanha, onClose }: MailingCampanhaModalProps) {
  const queryClient = useQueryClient()
  const [assunto, setAssunto] = useState(campanha?.assunto || '')
  // Campanha nova já nasce com o modelo padrão FinOps (pedido do usuário, 2026-10-16 —
  // reconstruído a partir do .msg real que o time usa). Editando uma existente, usa o
  // conteúdo salvo dela, nunca o modelo por cima.
  const [corpoHtml, setCorpoHtml] = useState(() => campanha?.corpo_html || buildTemplatePadraoFinOps())
  const [remetenteNome, setRemetenteNome] = useState(campanha?.remetente_nome || (campanha ? '' : 'FinOps Vivo'))
  const [remetenteEmail, setRemetenteEmail] = useState(campanha?.remetente_email || (campanha ? '' : 'finops.vivo.br@telefonica.com'))
  const [emailTeste, setEmailTeste] = useState('')
  const [mostrarPreview, setMostrarPreview] = useState(false)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = { assunto, corpo_html: corpoHtml, remetente_email: remetenteEmail || null, remetente_nome: remetenteNome || null }
      if (campanha) await atualizarCampanha(campanha.id, input)
      else await criarCampanha(input)
    },
    onSuccess: () => {
      window.showToast?.('Rascunho salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar: ' + e.message, 'error'),
  })

  const testeMutation = useMutation({
    mutationFn: (id: number) => enviarTesteCampanha(id, emailTeste),
    onSuccess: (r) => window.showToast?.(r.message, 'success'),
    onError: (e: Error) => window.showToast?.('Erro ao enviar teste: ' + e.message, 'error'),
  })

  async function handleEnviarTeste() {
    if (!emailTeste.trim()) { window.showToast?.('Informe um e-mail para o teste.', 'error'); return }
    if (!assunto.trim()) { window.showToast?.('Preencha o assunto antes de testar.', 'error'); return }
    // Precisa existir no banco pra /enviar-teste funcionar — salva (ou atualiza) o
    // rascunho primeiro, silenciosamente, sem fechar o modal.
    let id = campanha?.id
    if (!id) {
      const criado = await criarCampanha({ assunto, corpo_html: corpoHtml, remetente_email: remetenteEmail || null, remetente_nome: remetenteNome || null })
      id = criado.id
      queryClient.invalidateQueries({ queryKey: ['mailing-campanhas'] })
    } else {
      await atualizarCampanha(id, { assunto, corpo_html: corpoHtml, remetente_email: remetenteEmail || null, remetente_nome: remetenteNome || null })
    }
    testeMutation.mutate(id)
  }

  function handleSalvar() {
    if (!assunto.trim()) { window.showToast?.('Assunto é obrigatório.', 'error'); return }
    saveMutation.mutate()
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 820, width: '94vw' }}>
        <div className="modal-header">
          <span>{campanha ? 'Editar Comunicado' : 'Novo Comunicado'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="mc-assunto">Assunto *</label>
            <input id="mc-assunto" type="text" placeholder="Ex: Atualização do FinOps Manager — Outubro/2026"
              value={assunto} onChange={(e) => setAssunto(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="mc-rem-nome">Nome do remetente</label>
              <input id="mc-rem-nome" type="text" placeholder="Vivo FinOps" value={remetenteNome} onChange={(e) => setRemetenteNome(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="mc-rem-email">E-mail do remetente</label>
              <input id="mc-rem-email" type="email" placeholder="finops@vivo.com.br" value={remetenteEmail} onChange={(e) => setRemetenteEmail(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Conteúdo do comunicado</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {!campanha && (
                  <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => { if (confirm('Limpar o conteúdo e começar do zero?')) setCorpoHtml('<p></p>') }}>
                    🗋 Começar em branco
                  </button>
                )}
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setMostrarPreview((v) => !v)}>
                  {mostrarPreview ? '✏ Voltar a editar' : '👁 Prévia'}
                </button>
              </div>
            </div>
            {mostrarPreview ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', maxHeight: 480, overflowY: 'auto', background: '#fff' }}>
                <div dangerouslySetInnerHTML={{ __html: corpoHtml }} />
              </div>
            ) : (
              <MailingComposer value={corpoHtml} onChange={setCorpoHtml} />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 14px', background: 'var(--bg-hover)', borderRadius: 8 }}>
            <input type="email" placeholder="seu-email@vivo.com.br" value={emailTeste} onChange={(e) => setEmailTeste(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }} />
            <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }}
              disabled={testeMutation.isPending} onClick={handleEnviarTeste}>
              {testeMutation.isPending ? 'Enviando...' : '📧 Enviar teste'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Sempre envie um teste pra si mesmo antes de disparar pra lista inteira.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saveMutation.isPending} onClick={handleSalvar}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar rascunho'}
          </button>
        </div>
      </div>
    </div>
  )
}

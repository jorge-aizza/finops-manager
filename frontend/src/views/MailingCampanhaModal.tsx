import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { atualizarCampanha, criarCampanha, enviarTesteCampanha, excluirTemplate, listTemplates, salvarTemplate } from '../api/mailing'
import type { MailingCampanha, MailingTemplate } from '../types/mailing'
import MailingComposer from '../components/MailingComposer'
import { buildTemplatePadraoFinOps } from '../lib/mailingTemplatePadrao'

interface MailingCampanhaModalProps {
  campanha: MailingCampanha | null // null = nova
  onClose: () => void
}

// O modelo FinOps que veio do .msg do usuário (2026-10-16) é um template EMBUTIDO, não
// uma linha salva no banco — resolvido com `window.location.origin` certo pro ambiente
// atual (dev/prod têm domínio diferente; salvar a URL da imagem a partir do servidor
// arriscaria gravar o domínio errado). Fica sempre disponível no seletor, não é excluível.
const TEMPLATE_EMBUTIDO_ID = -1

// Só edita campanhas em rascunho — depois de "Enviar" a campanha vira histórico
// (ver painel de acompanhamento em MailingView), não dá pra voltar e mudar o texto
// de um comunicado que já saiu pra parte dos destinatários.
export default function MailingCampanhaModal({ campanha, onClose }: MailingCampanhaModalProps) {
  const queryClient = useQueryClient()
  const [assunto, setAssunto] = useState(campanha?.assunto || '')
  // Campanha nova começa em branco — o usuário escolhe explicitamente "Usar modelo" se
  // quiser partir de um pronto (pedido do usuário, 2026-10-16: em vez de pré-preencher
  // escondido, dar as três opções visíveis: usar modelo / salvar como modelo / criar novo).
  const [corpoHtml, setCorpoHtml] = useState(campanha?.corpo_html || '<p></p>')
  const [remetenteNome, setRemetenteNome] = useState(campanha?.remetente_nome || (campanha ? '' : 'FinOps Vivo'))
  const [remetenteEmail, setRemetenteEmail] = useState(campanha?.remetente_email || (campanha ? '' : 'finops.vivo.br@telefonica.com'))
  const [emailTeste, setEmailTeste] = useState('')
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const [seletorModeloAberto, setSeletorModeloAberto] = useState(false)

  const templatesQuery = useQuery({ queryKey: ['mailing-templates'], queryFn: listTemplates, enabled: seletorModeloAberto })
  const templateEmbutido: MailingTemplate = {
    id: TEMPLATE_EMBUTIDO_ID, nome: 'Modelo FinOps — Governança de Recursos Órfãos',
    corpo_html: buildTemplatePadraoFinOps(), remetente_nome: 'FinOps Vivo', remetente_email: 'finops.vivo.br@telefonica.com',
    criado_por: null, criado_em: '', atualizado_em: '',
  }

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

  const salvarTemplateMutation = useMutation({
    mutationFn: (nome: string) => salvarTemplate({ nome, corpo_html: corpoHtml, remetente_nome: remetenteNome || null, remetente_email: remetenteEmail || null }),
    onSuccess: () => {
      window.showToast?.('Modelo salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-templates'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar modelo: ' + e.message, 'error'),
  })

  const excluirTemplateMutation = useMutation({
    mutationFn: (id: number) => excluirTemplate(id),
    onSuccess: () => {
      window.showToast?.('Modelo excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['mailing-templates'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir modelo: ' + e.message, 'error'),
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

  function handleUsarTemplate(tpl: MailingTemplate) {
    const temConteudo = corpoHtml.replace(/<[^>]+>/g, '').trim().length > 0
    if (temConteudo && !confirm(`Substituir o conteúdo atual pelo modelo "${tpl.nome}"?`)) return
    setCorpoHtml(tpl.corpo_html)
    if (tpl.remetente_nome) setRemetenteNome(tpl.remetente_nome)
    if (tpl.remetente_email) setRemetenteEmail(tpl.remetente_email)
    setSeletorModeloAberto(false)
  }

  function handleSalvarComoModelo() {
    const nome = window.prompt('Nome do modelo:')
    if (!nome?.trim()) return
    salvarTemplateMutation.mutate(nome.trim())
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 1100, width: '96vw' }}>
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

          <div className="form-group" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Conteúdo do comunicado</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => setSeletorModeloAberto((v) => !v)}>
                  📋 Usar modelo
                </button>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                  disabled={salvarTemplateMutation.isPending} onClick={handleSalvarComoModelo}>
                  💾 Salvar como modelo
                </button>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => { if (confirm('Limpar o conteúdo e começar do zero?')) setCorpoHtml('<p></p>') }}>
                  🗋 Criar novo (em branco)
                </button>
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setMostrarPreview((v) => !v)}>
                  {mostrarPreview ? '✏ Voltar a editar' : '👁 Prévia'}
                </button>
              </div>
            </div>

            {seletorModeloAberto && (
              <div style={{
                position: 'absolute', top: 36, right: 0, zIndex: 20, width: 340,
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,.25)', maxHeight: 320, overflowY: 'auto',
              }}>
                <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  Modelos disponíveis
                </div>
                <ModeloItem tpl={templateEmbutido} embutido onUsar={handleUsarTemplate} />
                {templatesQuery.isLoading && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
                {(templatesQuery.data || []).map((tpl) => (
                  <ModeloItem key={tpl.id} tpl={tpl} onUsar={handleUsarTemplate}
                    onExcluir={() => { if (confirm(`Excluir o modelo "${tpl.nome}"?`)) excluirTemplateMutation.mutate(tpl.id) }} />
                ))}
              </div>
            )}

            {mostrarPreview ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', maxHeight: 560, overflowY: 'auto', background: '#fff' }}>
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

function ModeloItem({ tpl, embutido, onUsar, onExcluir }: { tpl: MailingTemplate; embutido?: boolean; onUsar: (t: MailingTemplate) => void; onExcluir?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
      <button type="button" onClick={() => onUsar(tpl)} style={{
        flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 12, padding: 0,
      }}>
        {tpl.nome}{embutido && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent)' }}>PADRÃO</span>}
      </button>
      {!embutido && onExcluir && (
        <button type="button" className="btn-icon delete" title="Excluir modelo" onClick={onExcluir} style={{ flexShrink: 0 }}>
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  )
}

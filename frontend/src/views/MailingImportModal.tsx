import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { importarContatos } from '../api/mailing'
import type { MailingImportLote } from '../types/mailing'

interface MailingImportModalProps {
  onClose: () => void
}

const EXT_VALIDAS = ['.csv', '.xlsx']

export default function MailingImportModal({ onClose }: MailingImportModalProps) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<MailingImportLote | null>(null)
  const [verInvalidos, setVerInvalidos] = useState(false)

  async function handleFile(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    const nomeMin = file.name.toLowerCase()
    if (!EXT_VALIDAS.some((ext) => nomeMin.endsWith(ext))) {
      window.showToast?.('Formato não aceito — use .csv ou .xlsx.', 'error')
      return
    }
    setEnviando(true)
    setResultado(null)
    setVerInvalidos(false)
    try {
      const lote = await importarContatos(file)
      setResultado(lote)
      queryClient.invalidateQueries({ queryKey: ['mailing-contatos'] })
      queryClient.invalidateQueries({ queryKey: ['mailing-import-lotes'] })
      window.showToast?.(`${lote.novos} novo(s), ${lote.atualizados} atualizado(s)${lote.invalidos ? `, ${lote.invalidos} inválido(s)` : ''}.`, 'success')
    } catch (e) {
      window.showToast?.('Erro ao importar: ' + (e as Error).message, 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span>Importar lista de destinatários</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ textAlign: 'center', padding: '24px 20px' }}>
          {!enviando && !resultado && (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 18px', lineHeight: 1.6 }}>
                Aceita <strong style={{ color: 'var(--text)' }}>.csv</strong> ou <strong style={{ color: 'var(--text)' }}>.xlsx</strong> com uma coluna de e-mail
                (cabeçalho &quot;Email&quot; ou similar na primeira linha) e, opcionalmente, uma coluna de nome.
                Quem já está cadastrado é atualizado, não duplicado — e quem já se descadastrou continua descadastrado,
                mesmo que apareça de novo numa planilha.
              </div>
              <input ref={inputRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
                onChange={(e) => { handleFile(e.target.files); e.target.value = '' }} />
              <button className="btn-primary" style={{ fontSize: 14, padding: '12px 34px' }} onClick={() => inputRef.current?.click()}>
                Selecionar arquivo
              </button>
            </>
          )}

          {enviando && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Importando...</div>
          )}

          {resultado && (
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: resultado.invalidos ? '#f9e2af' : '#22c55e', marginBottom: 8 }}>
                {resultado.invalidos ? '⚠️ Importação concluída, com avisos' : '✅ Importação concluída'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                {resultado.total_linhas} linha(s) lidas · <strong style={{ color: '#22c55e' }}>{resultado.novos}</strong> novo(s) ·{' '}
                <strong style={{ color: 'var(--accent)' }}>{resultado.atualizados}</strong> atualizado(s)
                {resultado.invalidos > 0 && (
                  <>
                    {' · '}<strong style={{ color: 'var(--danger)' }}>{resultado.invalidos}</strong> inválido(s)
                    <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 11, padding: '2px 10px' }} onClick={() => setVerInvalidos((v) => !v)}>
                      {verInvalidos ? 'Ocultar' : 'Ver'}
                    </button>
                  </>
                )}
              </div>
              {verInvalidos && resultado.invalidos_detalhe.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 6, padding: '8px 12px', maxHeight: 160, overflowY: 'auto' }}>
                  {resultado.invalidos_detalhe.map((v, i) => <div key={i}>⚠ {v}</div>)}
                </div>
              )}
              <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 16px', marginTop: 16 }} onClick={() => setResultado(null)}>
                Importar outro arquivo
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

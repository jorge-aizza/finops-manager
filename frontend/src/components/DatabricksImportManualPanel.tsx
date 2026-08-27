import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadDatabricksImport } from '../api/databricksColeta'

// Importação manual (CSV) — pedido do usuário (2026-08-27), mesma ideia do
// "Importação Manual" já existente pra Azure (ImportManualPanel.tsx), mas bem
// mais simples: só .csv (um export manual que o próprio usuário monta a
// partir de uma query no SQL Editor do Databricks, não o formato oficial
// grande do Azure Cost Management) e sem barra de progresso própria — o
// progresso real já é mostrado pelo DatabricksColetaMonitor (mesma
// infraestrutura de _dbxColetaProgresso que a coleta ao vivo usa, reaproveitada
// no servidor pra não duplicar um segundo mecanismo de job/polling).
export default function DatabricksImportManualPanel() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      window.showToast?.('Apenas arquivos .csv são aceitos.', 'error')
      return
    }
    setUploading(true)
    try {
      await uploadDatabricksImport(file)
      window.showToast?.('Importação iniciada — acompanhe o progresso acima.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-coleta-status'] })
    } catch (e) {
      window.showToast?.('Erro ao importar: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>📥 Importação Manual</strong> — envie um .csv com o resultado de
        uma consulta no SQL Editor do Databricks contra <code>system.billing.usage</code>. Colunas aceitas:{' '}
        <code>workspace_id</code>, <code>sku_name</code>, <code>produto_origem</code>, <code>usage_date</code>,{' '}
        <code>usage_unit</code>, <code>usage_quantity</code>, <code>usuario</code>, <code>preco_unitario</code>,{' '}
        <code>custo_estimado</code>, <code>usage_metadata</code>, <code>custom_tags</code> (as duas últimas,
        opcionais, aceitam JSON). Obrigatórias: workspace_id, sku_name, usage_date.
      </div>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={(e) => { handleFile(e.target.files); e.target.value = '' }} />
      <button className="btn-ghost" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? 'Enviando...' : 'Selecionar Arquivo .csv'}
      </button>
    </div>
  )
}

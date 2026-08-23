import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { getImportStatus, uploadImportFile } from '../api/coleta'
import type { ImportJob } from '../types/coleta'

interface ArquivoResultado {
  arquivo: string
  erro: string
}

interface Progresso {
  idxAtual: number
  total: number
  arquivoAtual: string
  subLabel: string
  pct: number
}

interface Resultado {
  tudoOk: boolean
  concluidos: number
  falhas: number
  totalInseridos: number
  totalErros: number
  errosArquivos: ArquivoResultado[]
  ultimoJob: ImportJob | null
}

const EXT_VALIDAS = ['.csv', '.parquet', '.zip']

function ehValido(nome: string): boolean {
  const n = nome.toLowerCase()
  return EXT_VALIDAS.some((ext) => n.endsWith(ext))
}

async function aguardarImport(jobId: string, idxAtual: number, total: number, onTick: (p: Omit<Progresso, 'idxAtual' | 'total'>) => void): Promise<ImportJob> {
  const baseWidth = ((idxAtual - 1) / total) * 100
  const sliceWidth = 100 / total
  while (true) {
    await new Promise((r) => setTimeout(r, 900))
    let job: ImportJob | null
    try {
      const r = await getImportStatus()
      job = r.job
    } catch {
      continue
    }
    if (!job || job.id !== jobId) {
      return { id: jobId, arquivo: '', idx: idxAtual, total, status: 'done', linhas: 0, inseridos: 0, atualizados: 0, erros: 0, erros_det: [], subArquivo: null, erro: null, iniciado: Date.now(), concluido: Date.now() }
    }
    const processado = (job.inseridos || 0) + (job.atualizados || 0) + (job.erros || 0)
    const totalLinhas = job.linhas || 0
    const localPct = totalLinhas > 0 ? Math.min(processado / totalLinhas, 0.99) : 0
    onTick({
      arquivoAtual: job.arquivo + (job.subArquivo ? ` · ${job.subArquivo}` : ''),
      subLabel: totalLinhas > 0 ? `${processado.toLocaleString('pt-BR')} / ${totalLinhas.toLocaleString('pt-BR')}` : 'carregando...',
      pct: Math.round(baseWidth + localPct * sliceWidth),
    })
    if (job.status !== 'running') return job
  }
}

// Porta de _setupImport()/_aguardarImport() (calculadora.js) — antes só
// acionável pelo botão "Selecionar Arquivos" dentro de #view-coleta, que
// virou permanentemente display:none quando 'coleta' entrou em
// MIGRATED_VIEWS (mesma causa raiz do bug real corrigido em Purge/Diagnóstico
// nesta mesma fase) — a importação manual de CSV/Parquet/ZIP, único caminho
// de ingestão pra quem não tem credenciais de API Azure configuradas, estava
// completamente inacessível na UI.
export default function ImportManualPanel() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [verErros, setVerErros] = useState(false)

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    const arquivos = Array.from(fileList)
    const invalidos = arquivos.filter((f) => !ehValido(f.name))
    if (invalidos.length) {
      window.showToast?.(`${invalidos.length} arquivo(s) ignorado(s): apenas .csv, .parquet e .zip são aceitos.`, 'error')
    }
    const validos = arquivos.filter((f) => ehValido(f.name))
    if (!validos.length) return

    window.suspendInactivityTimer?.()
    setUploading(true)
    setResultado(null)
    setVerErros(false)
    setProgresso({ idxAtual: 1, total: validos.length, arquivoAtual: validos[0].name, subLabel: '', pct: 0 })

    let totalInseridos = 0, totalErros = 0, concluidos = 0, falhas = 0
    const errosArquivos: ArquivoResultado[] = []
    let ultimoJob: ImportJob | null = null

    for (let i = 0; i < validos.length; i++) {
      const file = validos[i]
      setProgresso({ idxAtual: i + 1, total: validos.length, arquivoAtual: file.name, subLabel: '', pct: Math.round((i / validos.length) * 100) })

      try {
        const outcome = await uploadImportFile(file, i + 1, validos.length)
        if (outcome.kind === 'conflict') {
          setProgresso((p) => p && ({ ...p, subLabel: 'Aguardando importação anterior concluir...' }))
          await new Promise((r) => setTimeout(r, 4000))
          i--
          continue
        }
        const job = await aguardarImport(outcome.jobId, i + 1, validos.length, (tick) => {
          setProgresso({ idxAtual: i + 1, total: validos.length, arquivoAtual: tick.arquivoAtual, subLabel: tick.subLabel, pct: tick.pct })
        })
        ultimoJob = job
        if (job.status === 'done') {
          totalInseridos += job.inseridos || 0
          totalErros += job.erros || 0
          concluidos++
        } else {
          falhas++
          errosArquivos.push({ arquivo: file.name, erro: job.erro || 'erro no servidor' })
        }
      } catch (e) {
        falhas++
        errosArquivos.push({ arquivo: file.name, erro: e instanceof ApiError ? e.message : String(e) })
      }
    }

    window.resumeInactivityTimer?.()
    setProgresso(null)
    const tudoOk = falhas === 0
    setResultado({ tudoOk, concluidos, falhas, totalInseridos, totalErros, errosArquivos, ultimoJob })
    setUploading(false)

    window.showToast?.(
      tudoOk
        ? `✅ ${concluidos} arquivo(s) — ${totalInseridos.toLocaleString('pt-BR')} registros inseridos.`
        : `⚠️ ${concluidos} ok · ${falhas} com erro.`,
      tudoOk ? 'success' : 'error',
    )

    if (concluidos > 0) {
      queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
      queryClient.invalidateQueries({ queryKey: ['coleta-cobertura'] })
      queryClient.invalidateQueries({ queryKey: ['azure-resumo'] })
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📥 Importação Manual</span>
      </div>
      <div style={{ padding: '24px 20px', textAlign: 'center' }}>
        {!uploading && !resultado && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto 18px', lineHeight: 1.6 }}>
              Aceita arquivos <strong style={{ color: 'var(--text)' }}>.csv</strong>, <strong style={{ color: 'var(--text)' }}>.parquet</strong> ou <strong style={{ color: 'var(--text)' }}>.zip</strong> exportados do Azure Cost Management. Múltiplos arquivos podem ser selecionados de uma vez.
            </div>
            <input ref={inputRef} type="file" accept=".csv,.parquet,.zip" multiple style={{ display: 'none' }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
            <button className="btn-primary" style={{ fontSize: 14, padding: '12px 34px' }} onClick={() => inputRef.current?.click()}>
              Selecionar Arquivos
            </button>
          </>
        )}

        {uploading && progresso && (
          <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Importando {progresso.total > 1 ? `${progresso.idxAtual} / ${progresso.total}` : ''}...</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{progresso.arquivoAtual}</span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', background: 'linear-gradient(90deg, var(--accent), #c084fc)', borderRadius: 3, width: `${progresso.pct}%`, transition: 'width .3s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{progresso.subLabel}</div>
          </div>
        )}

        {resultado && (
          <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: resultado.tudoOk ? '#22c55e' : '#f9e2af', marginBottom: 8 }}>
              {resultado.tudoOk ? '✅ Importação concluída' : `⚠️ ${resultado.concluidos} ok · ${resultado.falhas} com erro`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {resultado.concluidos} arquivo{resultado.concluidos !== 1 ? 's' : ''} · <strong style={{ color: '#22c55e' }}>{resultado.totalInseridos.toLocaleString('pt-BR')}</strong> novos · {resultado.totalErros.toLocaleString('pt-BR')} ignorados
              {(resultado.ultimoJob?.erros ?? 0) > 0 && resultado.ultimoJob?.erros_det.length ? (
                <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 11, padding: '2px 10px' }} onClick={() => setVerErros((v) => !v)}>
                  {verErros ? 'Ocultar' : `Ver ${resultado.ultimoJob.erros} erro(s)`}
                </button>
              ) : null}
            </div>
            {resultado.errosArquivos.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {resultado.errosArquivos.map((e, i) => (
                  <div key={i}>⚠ <strong style={{ color: 'var(--danger)' }}>{e.arquivo}</strong>: {e.erro}</div>
                ))}
              </div>
            )}
            {verErros && resultado.ultimoJob && (
              <div className="table-wrapper" style={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Linha</th><th>Mensagem</th><th>cost_date</th><th>subscription_id</th><th>resource_id</th></tr>
                  </thead>
                  <tbody>
                    {resultado.ultimoJob.erros_det.map((d, i) => (
                      <tr key={i}>
                        <td style={{ textAlign: 'center' }}>{d.linha ?? '—'}</td>
                        <td style={{ color: 'var(--danger)' }}>{d.msg || '—'}</td>
                        <td>{d.cost_date || '—'}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>{d.subscription_id || '—'}</td>
                        <td style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>{d.resource_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 16px' }} onClick={() => { setResultado(null); setVerErros(false) }}>
                Importar mais arquivos
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

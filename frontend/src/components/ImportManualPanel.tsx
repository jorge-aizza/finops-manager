import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { beginResumableImport, finishResumableImport, getImportStatus, IMPORT_CHUNK_SIZE, uploadImportChunk } from '../api/coleta'
import type { ImportJob } from '../types/coleta'
import FinopsLogo from './FinopsLogo'
import './ImportManualPanel.css'

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

interface EstadoImportacao {
  uploading: boolean
  awaitingFiles: boolean
  progresso: Progresso | null
  resultado: Resultado | null
}

const EXT_VALIDAS = ['.csv', '.parquet', '.zip']
const estadoInicial: EstadoImportacao = { uploading: false, awaitingFiles: false, progresso: null, resultado: null }
let estadoImportacao = estadoInicial
let operacaoAtiva = false
let verificandoStatus = false
const ouvintes = new Set<() => void>()

function assinarImportacao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => ouvintes.delete(ouvinte)
}

function obterEstadoImportacao(): EstadoImportacao {
  return estadoImportacao
}

function atualizarEstadoImportacao(parcial: Partial<EstadoImportacao>) {
  estadoImportacao = { ...estadoImportacao, ...parcial }
  ouvintes.forEach((ouvinte) => ouvinte())
}

export function resetImportManualState() {
  operacaoAtiva = false
  verificandoStatus = false
  atualizarEstadoImportacao(estadoInicial)
}

function ehValido(nome: string): boolean {
  const n = nome.toLowerCase()
  return EXT_VALIDAS.some((ext) => n.endsWith(ext))
}

async function aguardarImport(jobId: string, idxAtual: number, total: number, onTick: (p: Progresso) => void): Promise<ImportJob> {
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
      return { id: jobId, arquivo: '', idx: idxAtual, total, status: 'error', linhas: 0, inseridos: 0, atualizados: 0, erros: 0, erros_det: [], subArquivo: null, erro: 'O servidor não encontrou mais esta importação. Verifique o histórico antes de reenviar.', iniciado: Date.now(), concluido: Date.now() }
    }
    const idxJob = job.idx || idxAtual
    const totalJobs = job.total || total
    const baseWidth = ((idxJob - 1) / totalJobs) * 100
    const sliceWidth = 100 / totalJobs
    const processado = (job.inseridos || 0) + (job.atualizados || 0) + (job.erros || 0)
    const totalLinhas = job.linhas || 0
    const localPct = totalLinhas > 0 ? Math.min(processado / totalLinhas, 0.99) : 0
    onTick({
      idxAtual: idxJob,
      total: totalJobs,
      arquivoAtual: job.arquivo + (job.subArquivo ? ` · ${job.subArquivo}` : ''),
      subLabel: totalLinhas > 0 ? `${processado.toLocaleString('pt-BR')} / ${totalLinhas.toLocaleString('pt-BR')}` : 'carregando...',
      pct: Math.round(baseWidth + localPct * sliceWidth),
    })
    if (job.status !== 'running') return job
  }
}

// Monta o mesmo formato de `Resultado` que handleFiles() produz ao final de um upload
// desta sessão, mas a partir de um job que já tinha terminado quando o componente
// montou (ver resync no useEffect abaixo) — reaproveitado pra não duplicar a lógica.
function resultadoDeJobConcluido(job: ImportJob): Resultado {
  const tudoOk = job.status === 'done'
  const arquivosComFalha = job.arquivos?.filter((arquivo) => arquivo.status === 'error')
  return {
    tudoOk,
    concluidos: job.concluidos ?? (tudoOk ? 1 : 0),
    falhas: job.falhas ?? (tudoOk ? 0 : 1),
    totalInseridos: job.inseridos || 0,
    totalErros: job.erros || 0,
    errosArquivos: arquivosComFalha
      ? arquivosComFalha.map((arquivo) => ({ arquivo: arquivo.arquivo, erro: arquivo.erro || 'erro no servidor' }))
      : tudoOk ? [] : [{ arquivo: job.arquivo, erro: job.erro || 'erro no servidor' }],
    ultimoJob: job,
  }
}

function finalizarImportacao(job: ImportJob, queryClient: QueryClient, mostrarToast = false) {
  const resultado = resultadoDeJobConcluido(job)
  operacaoAtiva = false
  window.resumeInactivityTimer?.()
  atualizarEstadoImportacao({ uploading: false, awaitingFiles: false, progresso: null, resultado })
  if (mostrarToast) {
    window.showToast?.(
      resultado.tudoOk
        ? `✅ ${resultado.concluidos} arquivo(s) — ${resultado.totalInseridos.toLocaleString('pt-BR')} registros inseridos.`
        : `⚠️ ${resultado.concluidos} ok · ${resultado.falhas} com erro.`,
      resultado.tudoOk ? 'success' : 'error',
    )
  }
  if (resultado.concluidos > 0) {
    queryClient.invalidateQueries({ queryKey: ['coleta-historico'] })
    queryClient.invalidateQueries({ queryKey: ['coleta-cobertura'] })
    queryClient.invalidateQueries({ queryKey: ['azure-resumo'] })
  }
}

async function acompanharImportacao(jobId: string, idx: number, total: number, queryClient: QueryClient, mostrarToast = false) {
  const jobFinal = await aguardarImport(jobId, idx, total, (progresso) => {
    atualizarEstadoImportacao({ progresso })
  })
  finalizarImportacao(jobFinal, queryClient, mostrarToast)
}

async function ressincronizarImportacao(queryClient: QueryClient) {
  if (operacaoAtiva || verificandoStatus) return
  verificandoStatus = true
  try {
    const { job } = await getImportStatus()
    if (operacaoAtiva || !job) return
    if (job.status === 'uploading') {
      const uploads = job.uploads || []
      const totalBytes = uploads.reduce((sum, file) => sum + file.tamanho, 0)
      const uploadedBytes = uploads.reduce((sum, file) => sum + file.recebidos.reduce((fileSum, chunk) => {
        return fileSum + Math.max(0, Math.min(IMPORT_CHUNK_SIZE, file.tamanho - chunk * IMPORT_CHUNK_SIZE))
      }, 0), 0)
      atualizarEstadoImportacao({
        uploading: true,
        awaitingFiles: true,
        resultado: null,
        progresso: {
          idxAtual: job.idx,
          total: job.total,
          arquivoAtual: job.arquivo,
          subLabel: 'Envio pausado. Selecione novamente os mesmos arquivos para retomar.',
          pct: totalBytes > 0 ? Math.floor(uploadedBytes / totalBytes * 100) : 0,
        },
      })
    } else if (job.status === 'running') {
      operacaoAtiva = true
      window.suspendInactivityTimer?.()
      atualizarEstadoImportacao({
        uploading: true,
        awaitingFiles: false,
        resultado: null,
        progresso: {
          idxAtual: job.idx,
          total: job.total,
          arquivoAtual: job.arquivo + (job.subArquivo ? ` · ${job.subArquivo}` : ''),
          subLabel: 'retomando acompanhamento...',
          pct: 0,
        },
      })
      await acompanharImportacao(job.id, job.idx, job.total, queryClient)
    } else if (job.status === 'done' || job.status === 'error') {
      atualizarEstadoImportacao({ resultado: resultadoDeJobConcluido(job) })
    }
  } catch {
    // A próxima montagem da tela tentará consultar o job novamente.
  } finally {
    verificandoStatus = false
  }
}

async function iniciarImportacao(files: File[], queryClient: QueryClient) {
  if (operacaoAtiva) return
  const retomando = estadoImportacao.awaitingFiles
  operacaoAtiva = true
  window.suspendInactivityTimer?.()
  atualizarEstadoImportacao({
    uploading: true,
    awaitingFiles: false,
    resultado: null,
    progresso: { idxAtual: 1, total: files.length, arquivoAtual: files[0].name, subLabel: 'Preparando envio retomável...', pct: 0 },
  })

  let jobId: string | null = null
  try {
    const upload = await beginResumableImport(files)
    jobId = upload.jobId
    const manifestMatches = upload.uploads.length === files.length && files.every((file, index) =>
      upload.uploads[index]?.arquivo === file.name && upload.uploads[index]?.tamanho === file.size && upload.uploads[index]?.ultimaModificacao === file.lastModified)
    if (!manifestMatches) throw new ApiError('Os arquivos selecionados não correspondem ao envio pausado. Selecione o mesmo conjunto de arquivos.')

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    let uploadedBytes = upload.uploads.reduce((sum, manifest) => sum + manifest.recebidos.reduce((fileSum, chunk) => {
      return fileSum + Math.max(0, Math.min(IMPORT_CHUNK_SIZE, manifest.tamanho - chunk * IMPORT_CHUNK_SIZE))
    }, 0), 0)
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex]
      const manifest = upload.uploads[fileIndex]
      const received = new Set(manifest.recebidos)
      const chunkCount = Math.ceil(file.size / IMPORT_CHUNK_SIZE)
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        if (received.has(chunkIndex)) continue
        const start = chunkIndex * IMPORT_CHUNK_SIZE
        const chunk = file.slice(start, Math.min(start + IMPORT_CHUNK_SIZE, file.size))
        await uploadImportChunk(jobId, fileIndex, chunkIndex, chunk)
        uploadedBytes += chunk.size
        atualizarEstadoImportacao({
          progresso: {
            idxAtual: fileIndex + 1,
            total: files.length,
            arquivoAtual: file.name,
            subLabel: `${uploadedBytes.toLocaleString('pt-BR')} / ${totalBytes.toLocaleString('pt-BR')} bytes enviados`,
            pct: totalBytes > 0 ? Math.floor(uploadedBytes / totalBytes * 100) : 0,
          },
        })
      }
    }

    const outcome = await finishResumableImport(jobId)
    if (outcome.kind === 'conflict') throw new ApiError(outcome.message)
    atualizarEstadoImportacao({
      progresso: estadoImportacao.progresso && { ...estadoImportacao.progresso, subLabel: 'Lote recebido pelo servidor; processamento em background.' },
    })
    await acompanharImportacao(outcome.jobId, 1, files.length, queryClient, true)
  } catch (e) {
    const mensagem = e instanceof ApiError ? e.message : String(e)
    operacaoAtiva = false
    window.resumeInactivityTimer?.()
    atualizarEstadoImportacao({
      uploading: Boolean(jobId) || retomando,
      awaitingFiles: Boolean(jobId) || retomando,
      progresso: Boolean(jobId) || retomando
        ? { idxAtual: 1, total: files.length, arquivoAtual: files[0].name, subLabel: 'Envio pausado. Selecione novamente os mesmos arquivos para retomar.', pct: 0 }
        : null,
    })
    window.showToast?.('Erro ao iniciar importação: ' + mensagem, 'error')
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
  const { uploading, awaitingFiles, progresso, resultado } = useSyncExternalStore(assinarImportacao, obterEstadoImportacao, obterEstadoImportacao)
  const [verErros, setVerErros] = useState(false)

  useEffect(() => {
    void ressincronizarImportacao(queryClient)
  }, [queryClient])

  function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    const arquivos = Array.from(fileList)
    const invalidos = arquivos.filter((f) => !ehValido(f.name))
    if (invalidos.length) {
      window.showToast?.(`${invalidos.length} arquivo(s) ignorado(s): apenas .csv, .parquet e .zip são aceitos.`, 'error')
    }
    const validos = arquivos.filter((f) => ehValido(f.name))
    if (!validos.length) return

    setVerErros(false)
    void iniciarImportacao(validos, queryClient)
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📥 Importação Manual</span>
      </div>
      <div style={{ padding: '24px 20px', textAlign: 'center' }}>
        {(!uploading || awaitingFiles) && !resultado && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto 18px', lineHeight: 1.6 }}>
              Aceita arquivos <strong style={{ color: 'var(--text)' }}>.csv</strong>, <strong style={{ color: 'var(--text)' }}>.parquet</strong> ou <strong style={{ color: 'var(--text)' }}>.zip</strong> exportados do Azure Cost Management. Múltiplos arquivos podem ser selecionados de uma vez.
              {awaitingFiles && <div style={{ marginTop: 8 }}>Envio pausado. Selecione novamente os mesmos arquivos para retomar.</div>}
            </div>
            <input ref={inputRef} type="file" accept=".csv,.parquet,.zip" multiple style={{ display: 'none' }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
            <button className="btn-primary" style={{ fontSize: 14, padding: '12px 34px' }} onClick={() => inputRef.current?.click()}>
              {awaitingFiles ? 'Selecionar Arquivos para Retomar' : 'Selecionar Arquivos'}
            </button>
          </>
        )}

        {uploading && progresso && (
          <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
            <div className="import-manual-visual" role="img" aria-label="Ciclo FinOps: Informar, Otimizar e Operar">
              <FinopsLogo height={72} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                {awaitingFiles
                  ? 'Envio aguardando seleção dos arquivos...'
                  : progresso.subLabel === 'Preparando envio retomável...' || progresso.subLabel.endsWith('bytes enviados')
                  ? `Enviando ${progresso.total} arquivo(s) ao servidor...`
                  : `Importando ${progresso.total > 1 ? `${progresso.idxAtual} / ${progresso.total}` : ''}...`}
              </span>
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
              <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 16px' }} onClick={() => { resetImportManualState(); setVerErros(false) }}>
                Importar mais arquivos
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

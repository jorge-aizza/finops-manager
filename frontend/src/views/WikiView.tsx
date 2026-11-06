import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { diffWords } from 'diff'
import {
  archiveWikiPage, createWikiPage, deleteWikiPage, getWikiPage, listWikiCategories, listWikiPages,
  listWikiRevisions, publishWikiPage, restoreWikiRevision, updateWikiPage,
} from '../api/wiki'
import type { WikiDocument, WikiNode, WikiPage, WikiPageInput, WikiPageSummary, WikiRevision } from '../types/wiki'
import './WikiView.css'

const WikiArticle = lazy(() => import('./WikiArticle'))
const WikiEditor = lazy(() => import('./WikiEditor'))

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function changedRevisionFields(current: WikiPage, revision: WikiRevision) {
  return [
    current.titulo !== revision.titulo && 'Título',
    current.categoria !== revision.categoria && 'Categoria',
    current.resumo !== revision.resumo && 'Resumo',
    JSON.stringify(current.conteudo) !== JSON.stringify(revision.conteudo) && 'Conteúdo',
    current.status !== revision.status && 'Status',
    current.portal_publico !== revision.portal_publico && 'Visibilidade pública',
  ].filter((field): field is string => Boolean(field))
}

function wikiDocumentText(document: WikiDocument) {
  const parts: string[] = []
  const visit = (node: WikiNode) => {
    if (node.type === 'text' && node.text) parts.push(node.text)
    if (node.type === 'wikiImage') parts.push(`[Imagem${node.attrs?.alt ? `: ${node.attrs.alt}` : ''}]`)
    if (['hardBreak', 'paragraph', 'heading', 'listItem', 'tableCell', 'tableHeader', 'tableRow'].includes(node.type)) parts.push('\n')
    node.content?.forEach(visit)
  }
  document.content.forEach(visit)
  return parts.join('').replace(/[ \t]+\n/g, '\n').trim()
}

function WriterActions({ page, onEdit, onPublish, onArchive, onDelete, onHistory }: {
  page: WikiPageSummary
  onEdit: () => void
  onPublish: () => void
  onArchive: () => void
  onDelete: () => void
  onHistory: () => void
}) {
  return (
    <div className="wiki-actions">
      <button className="btn-ghost" onClick={onHistory} title="Histórico de versões">Histórico</button>
      <button className="btn-ghost" onClick={onEdit} title="Editar artigo">Editar</button>
      {page.status !== 'publicado' && <button className="btn-primary" onClick={onPublish}>Publicar</button>}
      <button className="btn-ghost wiki-archive-action" onClick={onArchive} title="Arquivar artigo">Arquivar</button>
      <button className="btn-ghost wiki-delete-action" onClick={onDelete} title="Excluir artigo">Excluir</button>
    </div>
  )
}

export default function WikiView() {
  const queryClient = useQueryClient()
  const canEdit = ['admin', 'finops'].includes(window.currentUser?.perfil || '')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [criando, setCriando] = useState(false)
  const [mostrarHistorico, setMostrarHistorico] = useState(false)
  const [previewRevisionId, setPreviewRevisionId] = useState<number | null>(null)

  const pagesQuery = useQuery({ queryKey: ['wiki-pages', busca, categoria], queryFn: () => listWikiPages(busca, categoria || undefined) })
  const categoriesQuery = useQuery({ queryKey: ['wiki-categorias'], queryFn: listWikiCategories })
  const pageQuery = useQuery({ queryKey: ['wiki-page', slug], queryFn: () => getWikiPage(slug!), enabled: Boolean(slug) })
  const revisionsQuery = useQuery({
    queryKey: ['wiki-revisoes', pageQuery.data?.id],
    queryFn: () => listWikiRevisions(pageQuery.data!.id),
    enabled: canEdit && mostrarHistorico && Boolean(pageQuery.data?.id),
  })

  function refreshPages() {
    void queryClient.invalidateQueries({ queryKey: ['wiki-pages'] })
    void queryClient.invalidateQueries({ queryKey: ['wiki-categorias'] })
  }

  const createMutation = useMutation({
    mutationFn: createWikiPage,
    onSuccess: (page) => {
      refreshPages()
      setSlug(page.slug)
      setCriando(false)
      setEditando(false)
    },
    onError: (error: Error) => window.showToast?.(error.message, 'error'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: WikiPageInput }) => updateWikiPage(id, input),
    onSuccess: (page) => {
      refreshPages()
      void queryClient.invalidateQueries({ queryKey: ['wiki-page', page.slug] })
      setEditando(false)
    },
    onError: (error: Error) => window.showToast?.(error.message, 'error'),
  })
  const publishMutation = useMutation({
    mutationFn: publishWikiPage,
    onSuccess: () => { refreshPages(); void queryClient.invalidateQueries({ queryKey: ['wiki-page', slug] }) },
    onError: (error: Error) => window.showToast?.(error.message, 'error'),
  })
  const archiveMutation = useMutation({
    mutationFn: archiveWikiPage,
    onSuccess: () => { refreshPages(); setSlug(null); setMostrarHistorico(false) },
    onError: (error: Error) => window.showToast?.(error.message, 'error'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteWikiPage,
    onSuccess: () => { refreshPages(); setSlug(null); setMostrarHistorico(false) },
    onError: (error: Error) => window.showToast?.(error.message, 'error'),
  })
  const restoreMutation = useMutation({
    mutationFn: ({ pageId, revisionId }: { pageId: number; revisionId: number }) => restoreWikiRevision(pageId, revisionId),
    onSuccess: (page) => {
      refreshPages()
      void queryClient.invalidateQueries({ queryKey: ['wiki-page', page.slug] })
      void queryClient.invalidateQueries({ queryKey: ['wiki-revisoes', page.id] })
      setMostrarHistorico(false)
      setPreviewRevisionId(null)
    },
    onError: (error: Error) => window.showToast?.(error.message, 'error'),
  })

  function savePage(input: WikiPageInput) {
    if (criando) createMutation.mutate(input)
    else if (pageQuery.data) updateMutation.mutate({ id: pageQuery.data.id, input })
  }

  function archivePage(page: WikiPage) {
    if (window.confirm(`Arquivar “${page.titulo}”? O artigo poderá ser recuperado pelo histórico.`)) {
      archiveMutation.mutate(page.id)
    }
  }

  function deletePage(page: WikiPage) {
    if (window.confirm(`Excluir “${page.titulo}” e todo o seu histórico? Esta ação é definitiva.`)) {
      deleteMutation.mutate(page.id)
    }
  }

  const pages = pagesQuery.data || []
  const selectedPage = pageQuery.data
  const isSaving = createMutation.isPending || updateMutation.isPending
  const previewRevision = revisionsQuery.data?.find((revision) => revision.id === previewRevisionId)
  const previewPage = selectedPage && previewRevision ? {
    ...selectedPage,
    titulo: previewRevision.titulo,
    categoria: previewRevision.categoria,
    resumo: previewRevision.resumo,
    status: previewRevision.status,
    portal_publico: previewRevision.portal_publico,
    atualizado_por: previewRevision.alterado_por,
    atualizado_em: previewRevision.alterado_em,
    conteudo: previewRevision.conteudo,
  } : null
  const contentDiff = selectedPage && previewRevision
    ? diffWords(wikiDocumentText(selectedPage.conteudo), wikiDocumentText(previewRevision.conteudo))
    : []

  return (
    <div className="wiki-view">
      <div className="view-hero">
        <h1 className="page-title">Base de conhecimento</h1>
        <p className="view-hero-sub">FinOps Manager</p>
      </div>

      <div className="wiki-toolbar-row">
        <label className="wiki-search">
          <span className="wiki-search-icon" aria-hidden="true">⌕</span>
          <input aria-label="Buscar artigos" placeholder="Buscar artigos..." value={busca} onChange={(event) => setBusca(event.target.value)} />
        </label>
        <select aria-label="Filtrar categoria" className="filter-select" value={categoria} onChange={(event) => setCategoria(event.target.value)}>
          <option value="">Todas as categorias</option>
          {(categoriesQuery.data || []).map((item) => <option key={item.categoria} value={item.categoria}>{item.categoria} ({item.total})</option>)}
        </select>
                {canEdit && <button className="btn-primary" onClick={() => { setSlug(null); setCriando(true); setEditando(true); setMostrarHistorico(false); setPreviewRevisionId(null) }}>Novo artigo</button>}
      </div>

      <div className="wiki-layout">
        <aside className="wiki-sidebar" aria-label="Artigos da base de conhecimento">
          <div className="wiki-sidebar-heading">ARTIGOS <span>{pages.length}</span></div>
          {pagesQuery.isLoading && <div className="wiki-state">Carregando artigos...</div>}
          {pagesQuery.isError && <div className="wiki-state wiki-error">Não foi possível carregar os artigos.</div>}
          {!pagesQuery.isLoading && !pagesQuery.isError && pages.length === 0 && <div className="wiki-state">Nenhum artigo encontrado.</div>}
          <div className="wiki-page-list">
            {pages.map((page) => (
              <button key={page.id} className={`wiki-page-link${slug === page.slug ? ' is-active' : ''}`} onClick={() => {
                setSlug(page.slug); setEditando(false); setCriando(false); setMostrarHistorico(false); setPreviewRevisionId(null)
              }}>
                <span className="wiki-page-category">{page.categoria}</span>
                <strong>{page.titulo}</strong>
                {page.resumo && <span className="wiki-page-summary">{page.resumo}</span>}
                {page.status === 'rascunho' && <span className="wiki-draft-label">Rascunho</span>}
              </button>
            ))}
          </div>
        </aside>

        <main className="wiki-main">
          <Suspense fallback={<div className="wiki-state" role="status">Carregando conteúdo...</div>}>
          {criando && editando && (
            <WikiEditor key="novo-artigo" saving={isSaving} onCancel={() => { setCriando(false); setEditando(false) }} onSave={savePage} />
          )}
          {!criando && editando && selectedPage && (
            <WikiEditor key={selectedPage.id} initial={selectedPage} saving={isSaving} onCancel={() => setEditando(false)} onSave={savePage} />
          )}
          {!editando && pageQuery.isLoading && <div className="wiki-state">Carregando artigo...</div>}
          {!editando && pageQuery.isError && <div className="wiki-state wiki-error">Não foi possível abrir o artigo.</div>}
          {!editando && selectedPage && (
            <article>
              <div className="wiki-article-head">
                <div>
                  <div className="wiki-eyebrow">{selectedPage.categoria.toUpperCase()}</div>
                  <h1>{selectedPage.titulo}</h1>
                  {selectedPage.resumo && <p className="wiki-lead">{selectedPage.resumo}</p>}
                  <div className="wiki-meta">Atualizado por {selectedPage.atualizado_por} · {formatDate(selectedPage.atualizado_em)}</div>
                </div>
                {canEdit && (
                  <WriterActions
                    page={selectedPage}
                    onEdit={() => { setMostrarHistorico(false); setPreviewRevisionId(null); setEditando(true) }}
                    onPublish={() => publishMutation.mutate(selectedPage.id)}
                    onArchive={() => archivePage(selectedPage)}
                    onDelete={() => deletePage(selectedPage)}
                    onHistory={() => { setMostrarHistorico((value) => !value); setPreviewRevisionId(null) }}
                  />
                )}
              </div>
              {selectedPage.status === 'rascunho' && <div className="wiki-draft-notice">Este artigo ainda não está publicado.</div>}
              {mostrarHistorico && canEdit && (
                <section className="wiki-history" aria-label="Histórico de versões">
                  <h2>Histórico de versões</h2>
                  {revisionsQuery.isLoading && <div className="wiki-state">Carregando histórico...</div>}
                  {!revisionsQuery.isLoading && revisionsQuery.data?.length === 0 && <div className="wiki-state">Ainda não há versões anteriores.</div>}
                  {(revisionsQuery.data || []).map((revision) => (
                    <div className="wiki-revision" key={revision.id}>
                      <div><strong>Versão {revision.versao}</strong><span>{revision.alterado_por} · {formatDate(revision.alterado_em)}</span></div>
                      <div className="wiki-revision-actions">
                        <button className="btn-ghost" aria-expanded={previewRevisionId === revision.id} onClick={() => setPreviewRevisionId((current) => current === revision.id ? null : revision.id)}>
                          {previewRevisionId === revision.id ? 'Fechar prévia' : 'Prévia'}
                        </button>
                        <button className="btn-ghost" disabled={restoreMutation.isPending} onClick={() => {
                          if (window.confirm(`Restaurar a versão ${revision.versao}? A versão atual será preservada no histórico.`)) {
                            restoreMutation.mutate({ pageId: selectedPage.id, revisionId: revision.id })
                          }
                        }}>Restaurar</button>
                      </div>
                    </div>
                  ))}
                  {previewRevision && previewPage && (
                    <div className="wiki-revision-preview">
                      <div className="wiki-revision-preview-head">
                        <div>
                          <h3>Prévia da versão {previewRevision.versao}</h3>
                          <span>{previewRevision.alterado_por} · {formatDate(previewRevision.alterado_em)}</span>
                        </div>
                        <button className="btn-ghost" onClick={() => setPreviewRevisionId(null)}>Fechar prévia</button>
                      </div>
                      <p className="wiki-revision-changes">
                        <strong>Campos alterados:</strong>{' '}
                        {changedRevisionFields(selectedPage, previewRevision).join(', ') || 'Nenhuma diferença nos campos registrados'}
                      </p>
                      <section className="wiki-revision-diff" aria-label="Comparação do conteúdo">
                        <h4>Diferenças no conteúdo</h4>
                        <p className="wiki-revision-diff-legend">
                          <span className="wiki-diff-legend-added">Novo (versão atual)</span>
                          <span className="wiki-diff-legend-removed">Antigo (versão selecionada)</span>
                        </p>
                        <div className="wiki-revision-diff-body">
                          {contentDiff.some((part) => part.added || part.removed)
                            ? contentDiff.map((part, partIndex) => {
                              const Tag = part.added ? 'del' : part.removed ? 'ins' : 'span'
                              return <Tag key={`${partIndex}-${part.value}`}>{part.value}</Tag>
                            })
                            : <span>Não há diferença textual. Pode haver mudança de formatação ou estrutura.</span>}
                        </div>
                      </section>
                      <div className="wiki-revision-details">
                        <strong>{previewRevision.titulo}</strong>
                        <span>{previewRevision.categoria} · {previewRevision.status === 'publicado' ? 'Publicado' : previewRevision.status === 'rascunho' ? 'Rascunho' : 'Arquivado'}</span>
                        {previewRevision.resumo && <span>{previewRevision.resumo}</span>}
                        <span>Portal público: {previewRevision.portal_publico ? 'Liberado' : 'Privado'}</span>
                      </div>
                      <WikiArticle key={`${selectedPage.id}-revision-${previewRevision.id}`} page={previewPage} />
                    </div>
                  )}
                </section>
              )}
              <WikiArticle key={`${selectedPage.id}-${selectedPage.atualizado_em}`} page={selectedPage} />
            </article>
          )}
          {!criando && !editando && !selectedPage && !pageQuery.isLoading && !pageQuery.isError && (
            <div className="wiki-welcome">
              <div className="wiki-welcome-mark" aria-hidden="true">W</div>
              <h1>Conhecimento FinOps</h1>
              <p>Selecione um artigo para abrir.</p>
            </div>
          )}
          </Suspense>
        </main>
      </div>
    </div>
  )
}
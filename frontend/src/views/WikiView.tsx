import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import {
  archiveWikiPage, createWikiPage, getWikiPage, listWikiCategories, listWikiPages,
  listWikiRevisions, publishWikiPage, restoreWikiRevision, updateWikiPage,
} from '../api/wiki'
import type { WikiPage, WikiPageInput, WikiPageSummary } from '../types/wiki'
import WikiEditor from './WikiEditor'
import './WikiView.css'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function WikiArticle({ page }: { page: WikiPage }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Link.configure({ openOnClick: false }), Underline],
    content: page.conteudo,
    editable: false,
    editorProps: { attributes: { class: 'wiki-content-body' } },
  }, [page.id, page.atualizado_em])
  return <EditorContent editor={editor} className="wiki-content" />
}

function WriterActions({ page, onEdit, onPublish, onArchive, onHistory }: {
  page: WikiPageSummary
  onEdit: () => void
  onPublish: () => void
  onArchive: () => void
  onHistory: () => void
}) {
  return (
    <div className="wiki-actions">
      <button className="btn-ghost" onClick={onHistory} title="Histórico de versões">Histórico</button>
      <button className="btn-ghost" onClick={onEdit} title="Editar artigo">Editar</button>
      {page.status !== 'publicado' && <button className="btn-primary" onClick={onPublish}>Publicar</button>}
      <button className="btn-ghost wiki-archive-action" onClick={onArchive} title="Arquivar artigo">Arquivar</button>
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
  const restoreMutation = useMutation({
    mutationFn: ({ pageId, revisionId }: { pageId: number; revisionId: number }) => restoreWikiRevision(pageId, revisionId),
    onSuccess: (page) => {
      refreshPages()
      void queryClient.invalidateQueries({ queryKey: ['wiki-page', page.slug] })
      void queryClient.invalidateQueries({ queryKey: ['wiki-revisoes', page.id] })
      setMostrarHistorico(false)
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

  const pages = pagesQuery.data || []
  const selectedPage = pageQuery.data
  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="wiki-view">
      <div className="view-hero">
        <div className="page-title">Base de conhecimento</div>
        <div className="view-hero-sub">FinOps Manager</div>
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
        {canEdit && <button className="btn-primary" onClick={() => { setSlug(null); setCriando(true); setEditando(true); setMostrarHistorico(false) }}>Novo artigo</button>}
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
                setSlug(page.slug); setEditando(false); setCriando(false); setMostrarHistorico(false)
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
                    onEdit={() => { setMostrarHistorico(false); setEditando(true) }}
                    onPublish={() => publishMutation.mutate(selectedPage.id)}
                    onArchive={() => archivePage(selectedPage)}
                    onHistory={() => setMostrarHistorico((value) => !value)}
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
                      <button className="btn-ghost" disabled={restoreMutation.isPending} onClick={() => {
                        if (window.confirm(`Restaurar a versão ${revision.versao}? A versão atual será preservada no histórico.`)) {
                          restoreMutation.mutate({ pageId: selectedPage.id, revisionId: revision.id })
                        }
                      }}>Restaurar</button>
                    </div>
                  ))}
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
        </main>
      </div>
    </div>
  )
}
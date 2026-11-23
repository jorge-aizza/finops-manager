import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createStorage, listSPs, updateStorage } from '../api/coleta'
import type { StorageConfig, StorageConfigInput } from '../types/coleta'

interface FormState {
  nome: string
  storage_account: string
  storage_container: string
  storage_prefix: string
  price_list_prefix: string
  reservas_prefix: string
  sp_id: string
  ativo: boolean
  coletar_price_list: boolean
  coletar_reservas: boolean
}

function emptyForm(): FormState {
  return {
    nome: '', storage_account: '', storage_container: '', storage_prefix: '', price_list_prefix: '', reservas_prefix: '',
    sp_id: '', ativo: true, coletar_price_list: true, coletar_reservas: true,
  }
}

function fromStorage(s: StorageConfig): FormState {
  return {
    nome: s.nome || '',
    storage_account: s.storage_account || '',
    storage_container: s.storage_container || '',
    storage_prefix: s.storage_prefix || '',
    price_list_prefix: s.price_list_prefix || '',
    reservas_prefix: s.reservas_prefix || '',
    sp_id: s.sp_id != null ? String(s.sp_id) : '',
    ativo: s.ativo,
    coletar_price_list: s.coletar_price_list !== false,
    coletar_reservas: s.coletar_reservas !== false,
  }
}

interface StorageModalProps {
  storage: StorageConfig | null
  onClose: () => void
}

// Só o CRUD básico (Fase A) — sem agendamento automático (dias/hora) nem
// botão "Testar" (chamada real ao Storage Account) — Fase B.
export default function StorageModal({ storage, onClose }: StorageModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => (storage ? fromStorage(storage) : emptyForm()))
  const spsQuery = useQuery({ queryKey: ['coleta-sps'], queryFn: listSPs })
  const storageCapableSPs = (spsQuery.data || []).filter((sp) => sp.ativo && sp.coletar_storage !== false)
  const exigeSPExplicita = storageCapableSPs.length > 1

  const saveMutation = useMutation({
    mutationFn: (input: StorageConfigInput) => (storage ? updateStorage(storage.id, input) : createStorage(input)),
    onSuccess: () => {
      window.showToast?.('Storage Account salvo com sucesso!', 'success')
      queryClient.invalidateQueries({ queryKey: ['coleta-storages'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar Storage Account: ' + e.message, 'error'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.storage_account.trim() || !form.storage_container.trim()) {
      window.showToast?.('Preencha Storage Account e Container.', 'error')
      return
    }
    if (exigeSPExplicita && !form.sp_id) {
      window.showToast?.('Selecione a Service Principal deste Storage.', 'error')
      return
    }
    saveMutation.mutate({
      nome: form.nome || 'Storage 1',
      storage_account: form.storage_account,
      storage_container: form.storage_container,
      storage_prefix: form.storage_prefix,
      price_list_prefix: form.price_list_prefix,
      reservas_prefix: form.reservas_prefix,
      sp_id: form.sp_id ? parseInt(form.sp_id, 10) : null,
      ativo: form.ativo,
      coletar_price_list: form.coletar_price_list,
      coletar_reservas: form.coletar_reservas,
    })
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>{storage ? 'Editar Storage Account' : 'Novo Storage Account'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form id="storage-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="storage-nome">Nome</label>
              <input id="storage-nome" type="text" placeholder="Storage 1" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="storage-account">Storage Account *</label>
              <input id="storage-account" type="text" value={form.storage_account} onChange={(e) => setForm({ ...form, storage_account: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="storage-container">Container *</label>
              <input id="storage-container" type="text" value={form.storage_container} onChange={(e) => setForm({ ...form, storage_container: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="storage-prefix">Prefixo</label>
              <input id="storage-prefix" type="text" value={form.storage_prefix} onChange={(e) => setForm({ ...form, storage_prefix: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="storage-pl-prefix">Prefixo do Price List</label>
              <input id="storage-pl-prefix" type="text" value={form.price_list_prefix} onChange={(e) => setForm({ ...form, price_list_prefix: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="storage-rsv-prefix">Prefixo de Reservas</label>
              <input id="storage-rsv-prefix" type="text" value={form.reservas_prefix} onChange={(e) => setForm({ ...form, reservas_prefix: e.target.value })} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Export agendado em Cost Management → Exports, dataset &ldquo;Reservations&rdquo;, pro
                mesmo Storage Account. Opcional — sem preencher, Reservas continua só via
                Sincronizar com Azure (SP) na tela de Reservas.
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="storage-sp-id">Service Principal{exigeSPExplicita ? ' *' : ''}</label>
              <select id="storage-sp-id" value={form.sp_id} onChange={(e) => setForm({ ...form, sp_id: e.target.value })}>
                <option value="">{exigeSPExplicita ? '— selecione a SP deste Storage —' : '— usar a única SP ativa habilitada —'}</option>
                {storageCapableSPs.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.nome} ({sp.client_id})</option>
                ))}
              </select>
              {!!(spsQuery.data || []).length && storageCapableSPs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Nenhuma SP com permissão de autenticação Storage. Habilite &ldquo;Autenticação Storage&rdquo; na SP.
                </div>
              )}
            </div>

            <div className="form-group" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Datasets deste Storage</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={form.coletar_price_list} onChange={(e) => setForm({ ...form, coletar_price_list: e.target.checked })} style={{ width: 'auto', marginTop: 2 }} />
                  <span>
                    <strong>Price List</strong><br />
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Importa arquivos de catálogo/price list desse prefixo.</span>
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={form.coletar_reservas} onChange={(e) => setForm({ ...form, coletar_reservas: e.target.checked })} style={{ width: 'auto', marginTop: 2 }} />
                  <span>
                    <strong>Reservas via Storage</strong><br />
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Importa export de Reservations desse Storage.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="storage-ativo" type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} style={{ width: 'auto' }} />
              <label htmlFor="storage-ativo" style={{ margin: 0 }}>Ativo</label>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" form="storage-form" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

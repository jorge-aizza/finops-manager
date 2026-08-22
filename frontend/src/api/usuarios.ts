import { apiFetch } from './client'
import type { Usuario } from '../types/acao'

// GET /api/usuarios retorna todos os usuários — o filtro por ativo é feito
// no cliente (mesmo padrão do openAcaoModal() legado).
export const listUsuarios = () => apiFetch<Usuario[]>('GET', '/usuarios')

import { apiFetch } from './client'
import type { OrfaosPublicaResposta } from '../types/orfaosPublica'

// Cache frio no servidor = consultas ao Resource Graph: passa fácil de 30s.
export const getOrfaosPublica = () =>
  apiFetch<OrfaosPublicaResposta>('GET', '/public/orfaos', undefined, 180000)

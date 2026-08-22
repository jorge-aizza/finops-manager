import { apiFetch } from './client'
import type { Projeto, ProjetoInput } from '../types/projeto'

export const listProjetos = () => apiFetch<Projeto[]>('GET', '/projetos')

export const createProjeto = (input: ProjetoInput) =>
  apiFetch<Projeto>('POST', '/projetos', input)

export const updateProjeto = (id: number, input: ProjetoInput) =>
  apiFetch<Projeto>('PUT', '/projetos/' + id, input)

export const deleteProjeto = (id: number) =>
  apiFetch<{ message: string }>('DELETE', '/projetos/' + id)

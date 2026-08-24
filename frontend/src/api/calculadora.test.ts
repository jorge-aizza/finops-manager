import { describe, expect, it } from 'vitest'
import { sortRgsComFilhos } from './calculadora'
import type { ResourceGroupOption } from '../types/calculadora'

function makeRg(overrides: Partial<ResourceGroupOption>): ResourceGroupOption {
  return {
    resource_group_name: 'RG-X', moeda: 'BRL', managed_type: null, managed_label: null, parent_rg: null,
    ...overrides,
  }
}

describe('sortRgsComFilhos', () => {
  it('coloca o filho logo após o pai quando o pai está presente na lista', () => {
    const rgs = [
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-WS1', managed_type: 'databricks', parent_rg: 'RG-WS1' }),
      makeRg({ resource_group_name: 'RG-WS1' }),
    ]
    const out = sortRgsComFilhos(rgs)
    expect(out.map((r) => r.resource_group_name)).toEqual(['RG-WS1', 'MANAGED-RG-ADBX-WS1'])
    expect(out[1].parent_rg).toBe('RG-WS1')
  })

  // Bug real corrigido (achado numa validação com dados reais de produção — múltiplos
  // workspaces Databricks apareciam soltos no dropdown do Portal Público, sem nenhum
  // agrupamento sob seus RGs pais, mesmo os pais estando presentes na lista): nomes de RG do
  // Azure são case-insensitive, mas o `parent_rg` resolvido pelo servidor (_resolveParentRgs)
  // às vezes vem em uma grafia diferente da que o RG pai realmente tem em
  // `resource_group_name` (ex: filho resolvido com parent_rg "RG-ADBX-X" maiúsculo, mas o RG
  // pai real na lista é "rg-adbx-x" minúsculo) — um Map chaveado pelo texto exato nunca batia.
  it('casa o pai com o filho mesmo quando a grafia (maiúsculas/minúsculas) diverge', () => {
    const rgs = [
      makeRg({ resource_group_name: 'rg-adbx-daud-brsouth-001-dev' }), // pai — grafia real minúscula
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-DAUD-BRSOUTH-001-DEV', managed_type: 'databricks', parent_rg: 'RG-ADBX-DAUD-BRSOUTH-001-DEV' }), // resolvido em maiúsculo
    ]
    const out = sortRgsComFilhos(rgs)
    expect(out.map((r) => r.resource_group_name)).toEqual(['rg-adbx-daud-brsouth-001-dev', 'MANAGED-RG-ADBX-DAUD-BRSOUTH-001-DEV'])
    expect(out[1].parent_rg).toBe('RG-ADBX-DAUD-BRSOUTH-001-DEV')
  })

  // Bug real corrigido: quando o RG pai resolvido pelo servidor não está presente na lista
  // atual (filtro de resource_groups[] do Portal Público liberou só o filho; ou o pai não
  // tem billing direto, então nunca aparece na lista de RGs distintos), o item deve virar
  // raiz de verdade — com parent_rg null — em vez de continuar "órfão" com um parent_rg
  // que aponta pra um RG que o usuário nunca vai ver como opção selecionável. Sem isso, o
  // dropdown (CmsMultiSelect.tsx, via `parentValue: r.parent_rg`) desenha "↳" + indentação
  // como se o item fosse filho de algo — vários RGs Databricks distintos e não-relacionados
  // aparentavam ser filhos uns dos outros.
  it('trata o filho como raiz (parent_rg=null) quando o pai resolvido não está na lista', () => {
    const rgs = [
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-DAUD-BRSOUTH-001', managed_type: 'databricks', parent_rg: 'RG-ADBX-DAUD-BRSOUTH-001' }),
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-DBTOB-BRSOUTH-001', managed_type: 'databricks', parent_rg: 'RG-ADBX-DBTOB-BRSOUTH-001' }),
    ]
    const out = sortRgsComFilhos(rgs)
    expect(out).toHaveLength(2)
    for (const r of out) expect(r.parent_rg).toBeNull()
  })

  it('mistura corretamente: um filho com pai presente e outro órfão na mesma lista', () => {
    const rgs = [
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-WS1', managed_type: 'databricks', parent_rg: 'RG-WS1' }),
      makeRg({ resource_group_name: 'RG-WS1' }),
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-ORFAO', managed_type: 'databricks', parent_rg: 'RG-NAO-LISTADO' }),
    ]
    const out = sortRgsComFilhos(rgs)
    const orfao = out.find((r) => r.resource_group_name === 'MANAGED-RG-ADBX-ORFAO')
    const filhoReal = out.find((r) => r.resource_group_name === 'MANAGED-RG-ADBX-WS1')
    expect(orfao?.parent_rg).toBeNull()
    expect(filhoReal?.parent_rg).toBe('RG-WS1')
  })

  it('ordena raízes e filhos alfabeticamente', () => {
    const rgs = [
      makeRg({ resource_group_name: 'RG-B' }),
      makeRg({ resource_group_name: 'RG-A' }),
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-B', managed_type: 'databricks', parent_rg: 'RG-A' }),
      makeRg({ resource_group_name: 'MANAGED-RG-ADBX-A', managed_type: 'databricks', parent_rg: 'RG-A' }),
    ]
    const out = sortRgsComFilhos(rgs)
    expect(out.map((r) => r.resource_group_name)).toEqual(['RG-A', 'MANAGED-RG-ADBX-A', 'MANAGED-RG-ADBX-B', 'RG-B'])
  })
})

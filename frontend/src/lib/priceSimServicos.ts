// Agrupa os PRODUTOS do catálogo em SERVIÇOS, para o assistente poder mostrar cada serviço da
// Azure como uma caixa — do jeito que a calculadora pública faz.
//
// Por que isto existe: o catálogo não guarda o nome do serviço. A Azure Retail Prices API
// devolve `serviceName` ("Virtual Machines"), mas o sync do projeto grava apenas
// `serviceFamily` ("Compute") — e a coluna `meter_category`, que seria o lugar natural, fica
// sempre nula porque a API nem devolve esse campo. Enquanto o sync não guardar `serviceName`,
// o nome do serviço é derivado do `product_name` aqui.
//
// Isso é heurística de nomenclatura, não dado: colapsa as 270 variantes de "Virtual Machines
// <série> Series <SO>" numa caixa só, e junta os 23 produtos de "Azure Database for PostgreSQL
// Flexible Server". Reduz 737 produtos de brazilsouth a ~243 serviços.

export interface ProdutoCatalogo {
  nome: string
  categoria?: string
  meters: number
  preco_min: number
}

export interface ServicoAgrupado {
  nome: string
  categoria: string
  produtos: string[]
  meters: number
  preco_min: number
}

// Regras explícitas primeiro — famílias grandes onde o nome do serviço é conhecido e o
// colapso genérico erraria.
const REGRAS: [RegExp, string][] = [
  [/^Virtual Machines/i, 'Virtual Machines'],
  [/Managed Disks|^Ultra Disks|^Azure Premium SSD/i, 'Managed Disks'],
  [/Cloud ?Services/i, 'Cloud Services'],
  [/Dedicated ?Host/i, 'Dedicated Host'],
  [/^HDInsight/i, 'HDInsight'],
  [/SSIS/i, 'SSIS (Data Factory)'],
  [/^Azure App Service|^Azure Functions|^Flex Consumption|^Premium Functions/i, 'Azure App Service'],
  [/^SQL Managed Instance/i, 'SQL Managed Instance'],
  [/^SQL Database|^SQL Data Warehouse/i, 'SQL Database'],
  [/^Azure Database for (MySQL|PostgreSQL|MariaDB)/i, ''],
  [/^Azure Cosmos DB|^Azure DocumentDB/i, 'Azure Cosmos DB'],
  [/Redis/i, 'Azure Cache for Redis'],
  [/^Azure OpenAI/i, 'Azure OpenAI'],
  [/Block Blob|Page Blob|^Blob Storage|^Blob Features|^Blob Lifecycle|^Change Feed/i, 'Blob Storage'],
  [/Data Lake Storage Gen2|ADLS Gen2/i, 'Data Lake Storage Gen2'],
  [/^Files|^Azure Files|^Premium Files|^File Sync/i, 'Azure Files'],
  [/Application Gateway/i, 'Application Gateway'],
  [/^ExpressRoute/i, 'ExpressRoute'],
  [/Routing Preference|Rtn Preference/i, 'Bandwidth'],
  [/^Azure Orbital/i, 'Azure Orbital'],
  [/^Microsoft Defender/i, 'Microsoft Defender'],
  [/^Microsoft Purview/i, 'Microsoft Purview'],
  [/^Azure Synapse/i, 'Azure Synapse Analytics'],
  [/^Azure Kubernetes Service/i, 'Azure Kubernetes Service'],
  [/^Container Instances/i, 'Container Instances'],
  [/^Azure Monitor|^Log Analytics|^Application Insights|^Insight and Analytics/i, 'Azure Monitor / Log Analytics'],
  [/^Azure Databricks/i, 'Azure Databricks'],
  [/^Logic Apps/i, 'Logic Apps'],
  [/^Azure Analysis Services/i, 'Azure Analysis Services'],
  [/^Azure Data Factory/i, 'Azure Data Factory'],
]

export function servicoDoProduto(produto: string): string {
  const base = produto.replace(/\s+(Windows|Linux)$/i, '').replace(/\s+-\s+(Windows|Linux)$/i, '')
  for (const [rx, nome] of REGRAS) {
    if (rx.test(base)) {
      // Regra com nome vazio = usa o próprio trecho que casou (ex.: "Azure Database for
      // PostgreSQL" + "Flexible Server" quando for o caso), em vez de um rótulo fixo.
      if (nome) return nome
      const m = base.match(rx)
      return (m ? m[0] : base) + (/Flexible/i.test(base) ? ' Flexible Server' : '')
    }
  }
  // Genérico: remove token de série/geração (Dsv5, Ev3, v2) e palavras de variante.
  const limpo = base
    .replace(/\b[A-Z][A-Za-z]{0,6}v\d+\b/g, '')
    .replace(/\b(Series|series|Promo)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return limpo || base
}

export function agruparServicos(produtos: ProdutoCatalogo[]): ServicoAgrupado[] {
  const mapa = new Map<string, ServicoAgrupado>()
  for (const p of produtos) {
    const nome = servicoDoProduto(p.nome)
    const categoria = p.categoria || 'Other'
    const chave = `${categoria}|${nome}`
    if (!mapa.has(chave)) mapa.set(chave, { nome, categoria, produtos: [], meters: 0, preco_min: Infinity })
    const s = mapa.get(chave)!
    s.produtos.push(p.nome)
    s.meters += p.meters
    s.preco_min = Math.min(s.preco_min, p.preco_min)
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

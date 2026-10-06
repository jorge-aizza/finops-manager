// Taxonomia de tamanhos de VM da Azure (uso geral, otimizado para memória, para computação...).
// Essa classificação NÃO existe no catálogo de preços — a Retail Prices API só traz
// `product_name` ("Virtual Machines Dsv5 Series"), sem dizer a que categoria a série pertence.
// Então o mapeamento vem da documentação oficial
// (learn.microsoft.com/azure/virtual-machines/sizes/overview) e é aplicado por prefixo da
// família, enquanto a LISTA de famílias e os preços continuam vindo do catálogo sincronizado.
// Conferido contra as ~160 famílias "Virtual Machines *" existentes em brazilsouth.

export type TipoVM = 'geral' | 'memoria' | 'computacao' | 'armazenamento' | 'gpu' | 'hpc' | 'confidencial' | 'outros'

export const TIPOS_VM: { id: TipoVM; label: string; descricao: string }[] = [
  { id: 'geral', label: 'Uso geral', descricao: 'CPU e memória equilibrados — web, app, dev/test (séries B, D, A)' },
  { id: 'memoria', label: 'Otimizado para memória', descricao: 'mais RAM por vCPU — banco de dados, cache, SAP (séries E, M)' },
  { id: 'computacao', label: 'Otimizado para computação', descricao: 'mais CPU por GB — lote, APIs de alto tráfego (série F)' },
  { id: 'armazenamento', label: 'Otimizado para armazenamento', descricao: 'disco local NVMe rápido — big data, NoSQL (série L)' },
  { id: 'gpu', label: 'GPU / aceleradas', descricao: 'treino e inferência de IA, renderização (séries N)' },
  { id: 'hpc', label: 'Alta performance (HPC)', descricao: 'simulação e cálculo científico com rede InfiniBand (série H)' },
  { id: 'confidencial', label: 'Computação confidencial', descricao: 'memória criptografada em uso (séries DC, EC)' },
  { id: 'outros', label: 'Outras', descricao: 'famílias que não entram nas categorias acima' },
]

// Extrai o nome da família a partir do product_name do catálogo:
// "Virtual Machines Dsv5 Series" → "Dsv5" | "Virtual Machines Dsv7-series Linux" → "Dsv7"
export function familiaDoProduto(produto: string): string {
  return produto
    .replace(/^Virtual Machines\s+/i, '')
    .replace(/\s*[-\s]series\b/i, '')
    .replace(/\s+(Windows|Linux)$/i, '')
    .trim()
}

// Classifica a família pelo prefixo. A ordem dos testes importa: DC/EC são computação
// confidencial e precisam ser checados ANTES de D e E, senão cairiam em uso geral/memória.
export function tipoDaFamilia(familia: string): TipoVM {
  const f = familia.toUpperCase()
  if (f.startsWith('DC') || f.startsWith('EC')) return 'confidencial'
  if (f.startsWith('N')) return 'gpu'
  if (f.startsWith('H')) return 'hpc'
  if (f.startsWith('L')) return 'armazenamento'
  if (f.startsWith('F')) return 'computacao'
  if (f.startsWith('E') || f.startsWith('M') || f.startsWith('G')) return 'memoria'
  if (f.startsWith('A') || f.startsWith('B') || f.startsWith('D')) return 'geral'
  return 'outros'
}

export type ArquiteturaCpu = 'intel' | 'amd' | 'arm' | 'indefinida'

export const ARQUITETURAS: { id: ArquiteturaCpu; label: string; descricao: string }[] = [
  { id: 'intel', label: 'Intel', descricao: 'Xeon — maior compatibilidade, padrão histórico' },
  { id: 'amd', label: 'AMD', descricao: 'EPYC — costuma sair ~10% mais barato no mesmo tamanho' },
  { id: 'arm', label: 'ARM', descricao: 'Ampere Altra — mais barato ainda, exige binário ARM64' },
]

// A Azure codifica o processador no próprio nome da família, pela convenção oficial de
// nomenclatura ([Família][Subfamília][vCPUs][letras aditivas][acelerador][versão]): a letra
// aditiva `a` significa AMD, `p` significa ARM (Ampere Altra), e a ausência das duas significa
// Intel. Daí Dsv5 = Intel, Dasv5 = AMD, Dpsv5 = ARM — e isso reaparece no SKU
// (Standard_D4s_v5 vs Standard_D4as_v5).
// As séries H (HPC) e N (GPU) NÃO seguem isso de forma confiável: o HBv4 é AMD sem ter `a` no
// nome, e o ND MI300X também. Para elas devolvemos 'indefinida' em vez de errar com confiança.
export function arquiteturaDaFamilia(familia: string): ArquiteturaCpu {
  const token = familia.trim().split(/\s+/)[0] || ''
  if (/^[HN]/i.test(token)) return 'indefinida'
  // 'DC'/'EC' (computação confidencial) são prefixos de duas letras; o resto tem uma.
  const prefixo = /^(DC|EC)/i.test(token) ? 2 : 1
  // Letras aditivas = o que vem depois do prefixo e antes da versão (vN). O recorte do
  // prefixo é o que evita ler o 'A' de "Av2" (família A, Intel) como AMD.
  const aditivas = token.slice(prefixo).split(/v\d/i)[0].toLowerCase()
  if (aditivas.includes('a')) return 'amd'
  if (aditivas.includes('p')) return 'arm'
  return 'intel'
}

export function rotuloArquitetura(a: ArquiteturaCpu): string {
  return ARQUITETURAS.find((x) => x.id === a)?.label ?? 'proc. não identificado'
}

// Tipo sugerido a partir da finalidade que o usuário declarou — só uma recomendação exibida
// como selo na tela de tipos; ele pode escolher qualquer um.
export function tipoRecomendado(finalidade: string): TipoVM {
  if (finalidade === 'banco') return 'memoria'
  if (finalidade === 'alta-performance') return 'computacao'
  return 'geral'
}

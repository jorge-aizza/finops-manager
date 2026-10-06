// Catálogo de TIPOS DE RECURSO do assistente guiado do Simulador de Preços — cada caixa é um
// recurso Azure faturável de verdade (VM, Disco, Firewall, IP Público, Load Balancer, Backup,
// Bandwidth, AKS, Storage, SQL), modelado a partir da arquitetura real de cada serviço:
//   - VM: série/tamanho + SO (Windows soma licença) — disco, IP público e firewall são
//     recursos cobrados à parte, não vêm embutidos no preço da VM.
//   - AKS: taxa de gerenciamento do cluster (Free = grátis, Standard/Premium = taxa por hora)
//     + node pool, que são VMs normais cobradas separadamente
//     (learn.microsoft.com/azure/aks/free-standard-pricing-tiers).
//   - Azure Firewall: cobrado por hora de deployment + dado processado, variando por tier.
//   - Load Balancer / IP Público / Bandwidth: cobrados separadamente da VM que atendem.
// `relacionados` é o grafo de dependências que o assistente usa para ir propondo o que ainda
// falta, até o cenário ficar completo (ver PriceSimWizard.tsx).
// Os termos de busca são heurísticas de nomenclatura contra `azure_price_list` — a Retail
// Prices API não expõe specs (vCPU/RAM/IOPS), só preço por meter/SKU. Nada aqui é IA/LLM.

import { arquiteturaDaFamilia, familiaDoProduto, rotuloArquitetura } from './priceSimVmTaxonomia'

export type Valor = string | boolean

export type Respostas = Record<string, Valor>

// Refinamento aplicado nos itens que o catálogo devolveu. Cada regra é uma PREFERÊNCIA: se
// uma delas esvaziaria o grupo (nomenclatura do catálogo mudou, região sem aquele meter), ela
// é ignorada em vez de deixar o usuário sem resultado nenhum.
export interface RefinoBusca {
  // product_name começa com — ex.: 'Virtual Machines', que exclui "Cloud Services FSv2
  // Series" e outros produtos de Compute que casam o mesmo nome de SKU.
  produtoComecaCom?: string
  // product_name contém / não contém — ex.: 'Windows', que separa o preço com licença de SO
  // do preço Linux ("Virtual Machines Dsv5 Series" vs "... Series Windows").
  produtoContem?: string
  produtoNaoContem?: string
  // meter_name termina com — separa o meter de capacidade ("P10 LRS Disk") dos acessórios
  // ("P10 LRS Disk Operations", "... Disk Mount").
  meterTerminaCom?: string
  // meter_name contém / não contém nenhum destes — ex.: excluir 'Spot' e 'Low Priority',
  // que são modelos de compra interrompíveis e custam ~1/5 do preço sob demanda.
  meterContem?: string
  meterNaoContem?: string[]
  ordenarPorPreco?: boolean
}

export interface BuscaSugerida {
  categoria: string
  q: string
  justificativa: string
  // product_name exato, quando o nome da família importa para não pegar meters de outra
  // forma de cobrança (ex.: "Premium SSD Managed Disks", por disco/mês, vs. "Azure Premium
  // SSD v2", por GiB/hora).
  produto?: string
  // Lista de product_name — usada pela caixa de um SERVIÇO, que agrupa vários produtos.
  produtos?: string[]
  // sku_name exato — usado pela busca manual em dois níveis.
  sku?: string
  refino?: RefinoBusca
  // Quantos itens exibir no resultado (padrão 5) — a lista de tamanhos de uma família de VM
  // precisa mostrar bem mais, já que é ela que o usuário percorre pra escolher.
  limite?: number
  // Usa o endpoint especializado de SKUs de VM em vez do /buscar genérico: ele filtra SO e
  // modelo de compra no servidor, necessário porque uma família pode ter mais de 100 meters.
  vmSkus?: { so: string; modelo: string }
  // Busca sem filtrar região. Necessário para meters que a Azure não publica por região —
  // a taxa de gerenciamento do AKS, por exemplo, existe em 114 regiões no catálogo, mas
  // nenhuma linha para brazilsouth.
  ignorarRegiao?: boolean
  // Grupo apenas informativo, sem consulta de preço — para quando a resposta correta é
  // "isso não é cobrado" (ex.: AKS no tier Free não tem meter de gerenciamento).
  semPreco?: boolean
}

export interface OpcaoPergunta {
  valor: string
  label: string
  descricao?: string
}

export interface PerguntaOpcoes {
  id: string
  tipo: 'opcoes'
  titulo: string
  opcoes: OpcaoPergunta[]
  mostrarSe?: (r: Respostas) => boolean
}

export interface PerguntaCheckbox {
  id: string
  tipo: 'checkbox'
  titulo: string
  label: string
  padrao: boolean
  mostrarSe?: (r: Respostas) => boolean
}

// Pergunta cujas opções vêm do catálogo em tempo real, não de uma lista fixa — o componente
// resolve a `fonte` (ver PriceSimWizard.tsx). É o que permite listar só as famílias de VM que
// existem de fato na região escolhida, com a contagem de tamanhos e o preço de entrada.
export interface PerguntaDinamica {
  id: string
  tipo: 'dinamica'
  titulo: string
  fonte: 'vm-tipo' | 'vm-familia'
  mostrarSe?: (r: Respostas) => boolean
}

export type PerguntaDef = PerguntaOpcoes | PerguntaCheckbox | PerguntaDinamica

export interface TipoRecursoDef {
  id: string
  titulo: string
  icone: string
  descricao: string
  // service_family do catálogo — vira o selo da caixa e a categoria da busca.
  tipoServico: string
  perguntas: PerguntaDef[]
  gerarBuscas: (r: Respostas) => BuscaSugerida[]
  // Tipos normalmente necessários junto com este — o assistente propõe os que ainda
  // não estão no cenário depois de configurar este recurso.
  relacionados: string[]
}

const TIPO_VM: TipoRecursoDef = {
  id: 'vm', titulo: 'VM', icone: '💻',
  descricao: 'Máquina virtual — o servidor em si, sem disco, rede ou firewall.',
  tipoServico: 'Compute',
  relacionados: ['disco', 'ip-publico', 'firewall', 'backup'],
  perguntas: [
    { id: 'finalidade', tipo: 'opcoes', titulo: 'Para que essa VM vai servir?', opcoes: [
      { valor: 'web', label: 'Servidor Web / Aplicação', descricao: 'Sites, APIs, aplicações de negócio.' },
      { valor: 'banco', label: 'Banco de Dados', descricao: 'Banco rodando na própria VM.' },
      { valor: 'alta-performance', label: 'Alta Performance', descricao: 'Processamento intensivo, filas, lote.' },
      { valor: 'dev-test', label: 'Dev/Test', descricao: 'Ambiente barato, não roda sempre.' },
    ] },
    { id: 'so', tipo: 'opcoes', titulo: 'Qual sistema operacional?', opcoes: [
      { valor: 'linux', label: 'Linux', descricao: 'sem custo de licença' },
      { valor: 'windows', label: 'Windows', descricao: 'mesma VM custa mais, por causa da licença' },
    ] },
    { id: 'modelo', tipo: 'opcoes', titulo: 'Qual modelo de compra?', opcoes: [
      { valor: 'sob-demanda', label: 'Sob demanda', descricao: 'preço cheio, sem risco de interrupção — padrão de produção' },
      { valor: 'spot', label: 'Spot', descricao: 'bem mais barato, mas a Azure pode desligar a VM a qualquer momento' },
    ] },
    { id: 'tipoVm', tipo: 'dinamica', titulo: 'Qual tipo de VM?', fonte: 'vm-tipo' },
    { id: 'familia', tipo: 'dinamica', titulo: 'Qual família?', fonte: 'vm-familia' },
  ],
  gerarBuscas: (r) => {
    const familia = String(r.familia || '')
    if (!familia) return []
    const windows = r.so === 'windows'
    const spot = r.modelo === 'spot'
    const nome = familiaDoProduto(familia)
    const arq = arquiteturaDaFamilia(nome)
    return [{
      categoria: 'Compute', q: '', produto: familia, limite: 30,
      vmSkus: { so: String(r.so || 'linux'), modelo: String(r.modelo || 'sob-demanda') },
      refino: { ordenarPorPreco: true },
      justificativa: `Tamanhos de ${nome}${arq !== 'indefinida' ? ` (processador ${rotuloArquitetura(arq)})` : ''}, do mais barato pro mais caro.`
        + (arq === 'intel'
          ? ' A variante AMD da mesma série (a letra "a" no nome, ex.: Dasv5 no lugar de Dsv5) costuma custar cerca de 10% menos no mesmo tamanho — vale voltar e comparar.'
          : arq === 'arm'
            ? ' ARM (Ampere) é a opção mais barata, mas sua aplicação precisa ter binário ARM64 — não roda imagem x86.'
            : '')
        + (windows
          ? ' A licença do Windows já vem embutida no preço — a mesma VM em Linux sai mais barata.'
          : ' Em Linux não há custo de licença de sistema operacional.')
        + (spot
          ? ' No modelo Spot o preço cai muito, mas a Azure pode desligar a VM a qualquer momento: use só para lote, dev/test ou cargas que toleram interrupção.'
          : ' Preço sob demanda, sem risco de interrupção.')
        + ' Vale comparar com as outras gerações da mesma letra, porque a geração antiga costuma custar MAIS que a nova no mesmo tamanho (ex.: D4s v3 é mais caro que D4s v5).',
    }]
  },
}

const TIPO_DISCO: TipoRecursoDef = {
  id: 'disco', titulo: 'Disco', icone: '💾',
  descricao: 'Managed Disk — disco de SO ou de dados anexado a uma VM.',
  tipoServico: 'Storage',
  relacionados: ['backup'],
  perguntas: [
    { id: 'desempenho', tipo: 'opcoes', titulo: 'Qual desempenho de disco?', opcoes: [
      { valor: 'Standard HDD', label: 'Standard HDD', descricao: 'mais barato — dev/test, dados frios' },
      { valor: 'Standard SSD', label: 'Standard SSD', descricao: 'equilíbrio — web/app de carga leve' },
      { valor: 'Premium SSD', label: 'Premium SSD', descricao: 'baixa latência — produção, banco de dados' },
      { valor: 'Ultra Disk', label: 'Ultra Disk', descricao: 'IOPS altíssimas — cargas críticas de I/O' },
    ] },
  ],
  gerarBuscas: (r) => {
    const desempenho = String(r.desempenho || 'Standard SSD')
    // Produtos exatos do catálogo: as famílias "Managed Disks" são cobradas por disco/mês
    // (meters "P10 LRS Disk", "E10 LRS Disk", "S10 LRS Disk"), que é o número útil para
    // estimativa. "Ultra Disks" só existe por GiB/hora.
    if (desempenho === 'Ultra Disk') {
      return [{ categoria: 'Storage', produto: 'Ultra Disks', q: '',
        justificativa: 'Ultra Disk entrega as IOPS mais altas da Azure e é cobrado por GiB/hora (mais IOPS e throughput provisionados à parte) — só vale quando o disco é comprovadamente o gargalo.' }]
    }
    const familia = desempenho === 'Premium SSD' ? 'Premium SSD Managed Disks'
      : desempenho === 'Standard SSD' ? 'Standard SSD Managed Disks'
      : 'Standard HDD Managed Disks'
    const serie = desempenho === 'Premium SSD' ? 'P' : desempenho === 'Standard SSD' ? 'E' : 'S'
    return [{ categoria: 'Storage', produto: familia, q: 'LRS Disk',
      refino: { meterTerminaCom: 'LRS Disk', ordenarPorPreco: true },
      justificativa: (desempenho === 'Premium SSD'
        ? 'Premium SSD reduz a latência de disco — I/O lento costuma ser o gargalo mais comum em produção e em banco de dados. '
        : desempenho === 'Standard SSD'
          ? 'Standard SSD já atende cargas leves sem o custo extra do Premium. '
          : 'Standard HDD é a opção mais barata — performance não é prioridade em dev/test ou dados frios. ')
        + `Cada meter da série ${serie} é um tamanho fixo de disco cobrado por mês (redundância local/LRS) — escolha o tamanho que cobre seus dados.` }]
  },
}

const TIPO_FIREWALL: TipoRecursoDef = {
  id: 'firewall', titulo: 'Firewall', icone: '🧱',
  descricao: 'Azure Firewall — proteção de perímetro da rede virtual.',
  tipoServico: 'Networking',
  relacionados: ['ip-publico'],
  perguntas: [
    { id: 'tier', tipo: 'opcoes', titulo: 'Qual tier de firewall?', opcoes: [
      { valor: 'basic', label: 'Basic', descricao: 'ambientes pequenos, tráfego baixo' },
      { valor: 'standard', label: 'Standard', descricao: 'filtragem de rede e aplicação, uso corporativo' },
      { valor: 'premium', label: 'Premium', descricao: 'IDPS e inspeção TLS, ambientes regulados' },
    ] },
  ],
  gerarBuscas: (r) => {
    const tier = String(r.tier || 'standard')
    const nome = tier === 'basic' ? 'Basic' : tier === 'premium' ? 'Premium' : 'Standard'
    // O tier está no sku_name e se repete no início do meter ("Standard Deployment",
    // "Standard Data Processed"). Excluímos 'Virtual Hub' porque as variantes de Virtual WAN
    // ("Premium Secured Virtual Hub Deployment", "Standard Secure Virtual Hub ...") casam o
    // mesmo tier mas são outro produto — note que a Azure grafa "Secured" e "Secure".
    const comum = { produto: 'Azure Firewall', categoria: 'Networking' }
    const refinoBase = { meterContem: nome, meterNaoContem: ['Virtual Hub'] }
    return [
      { ...comum, q: 'Deployment', refino: { ...refinoBase, meterTerminaCom: 'Deployment' },
        justificativa: `Taxa fixa por hora do firewall no tier ${nome} — cobrada enquanto ele existir, independente de tráfego. `
          + (tier === 'premium' ? 'O Premium adiciona IDPS e inspeção TLS, e custa mais por hora que o Standard.'
            : tier === 'basic' ? 'O Basic é o mais barato, mas tem throughput limitado e é indicado só para ambientes pequenos.'
            : 'O Standard cobre a maioria dos casos corporativos.') },
      { ...comum, q: 'Data Processed', refino: { ...refinoBase, meterTerminaCom: 'Data Processed' },
        justificativa: 'Segundo componente obrigatório: todo GB que passa pelo firewall é cobrado à parte da taxa por hora.' },
    ]
  },
}

const TIPO_IP_PUBLICO: TipoRecursoDef = {
  id: 'ip-publico', titulo: 'IP Público', icone: '🌐',
  descricao: 'Endereço IP público para expor um recurso na internet.',
  tipoServico: 'Networking',
  relacionados: ['bandwidth'],
  perguntas: [
    { id: 'tipo', tipo: 'opcoes', titulo: 'Qual tipo de IP público?', opcoes: [
      { valor: 'standard', label: 'Standard (estático)', descricao: 'recomendado — IP fixo, exigido por Load Balancer Standard' },
      { valor: 'basic', label: 'Basic (dinâmico)', descricao: 'legado, mais barato, em descontinuação' },
    ] },
  ],
  // Meters reais do produto "IP Addresses": "Standard IPv4 Static Public IP",
  // "Basic IPv4 Static Public IP", "Basic IPv4 Dynamic Public IP" e "Global IPv4 Static".
  gerarBuscas: (r) => {
    const basic = r.tipo === 'basic'
    return [{
      categoria: 'Networking', produto: 'IP Addresses', q: 'Public IP',
      refino: { meterContem: basic ? 'Basic' : 'Standard', ordenarPorPreco: true },
      justificativa: basic
        ? 'IP Basic é mais barato, mas a Microsoft já o colocou em descontinuação e ele não funciona com Load Balancer Standard. Aparecem as variantes estática e dinâmica.'
        : 'IP Standard estático mantém o endereço fixo e é o exigido por Load Balancer Standard e NAT Gateway.',
    }]
  },
}

const TIPO_LOAD_BALANCER: TipoRecursoDef = {
  id: 'load-balancer', titulo: 'Load Balancer', icone: '⚖️',
  descricao: 'Distribui tráfego entre várias VMs ou pods.',
  tipoServico: 'Networking',
  relacionados: ['ip-publico', 'bandwidth'],
  perguntas: [
    { id: 'tier', tipo: 'opcoes', titulo: 'Qual tier de Load Balancer?', opcoes: [
      { valor: 'standard', label: 'Standard', descricao: 'recomendado — SLA, zonas de disponibilidade' },
      { valor: 'basic', label: 'Basic', descricao: 'legado, sem SLA, em descontinuação' },
    ] },
  ],
  // O Basic Load Balancer não tem meter: é gratuito (e está em descontinuação). O Standard tem
  // dois componentes — regras por hora e dado processado por GB. A Azure não publica esses
  // meters por região para brazilsouth, só em Global e zonas de operadora; como o preço do
  // Standard LB é uniforme entre regiões (US$ 0,025/h até 5 regras), buscamos sem filtrar
  // região e avisamos na justificativa.
  gerarBuscas: (r) => {
    if (r.tier === 'basic') {
      return [{ categoria: 'Networking', q: '', semPreco: true, justificativa:
        'O Basic Load Balancer não é cobrado — não existe meter de preço para ele. Em troca, não tem SLA, não suporta zonas de disponibilidade e está em descontinuação pela Microsoft: para produção, volte e escolha Standard.' }]
    }
    const comum = { categoria: 'Networking', produto: 'Load Balancer', ignorarRegiao: true, limite: 3 }
    const refinoBase = { meterContem: 'Standard', meterNaoContem: ['Gateway', 'Global'] }
    return [
      { ...comum, q: 'LB Rules', refino: { ...refinoBase, meterContem: 'Standard Included' },
        justificativa: 'Taxa por hora das regras de balanceamento (as 5 primeiras entram no valor incluído; acima disso há cobrança de excedente por regra). Atenção: a Azure não publica esse meter para a região escolhida — o valor é de outra região, e para o Standard Load Balancer ele é uniforme.' },
      { ...comum, q: 'Data Processed', refino: { ...refinoBase, meterTerminaCom: 'Data Processed' },
        justificativa: 'Segundo componente: todo GB processado pelo balanceador é cobrado à parte das regras.' },
    ]
  },
}

const TIPO_BACKUP: TipoRecursoDef = {
  id: 'backup', titulo: 'Backup', icone: '🛟',
  descricao: 'Azure Backup — proteção contra perda de dados.',
  tipoServico: 'Storage',
  relacionados: [],
  perguntas: [
    // Só LRS e GRS: são as duas redundâncias que têm meter de "Data Stored" confirmado no
    // catálogo para o produto Backup nesta região.
    { id: 'redundancia', tipo: 'opcoes', titulo: 'Qual redundância do backup?', opcoes: [
      { valor: 'LRS', label: 'Local (LRS)', descricao: 'mais barato — réplicas em um único datacenter' },
      { valor: 'GRS', label: 'Geográfica (GRS)', descricao: 'réplica em outra região, protege contra desastre regional' },
    ] },
  ],
  // Meters do produto "Backup" no formato "<Tier> <Redundância> Data Stored" (1 GB/Month) —
  // o filtro por 'Data Stored' separa o armazenamento do backup das operações de escrita.
  gerarBuscas: (r) => {
    const red = String(r.redundancia || 'LRS')
    return [{
      categoria: 'Storage', produto: 'Backup', q: 'Data Stored',
      refino: { meterTerminaCom: 'Data Stored', meterContem: red, ordenarPorPreco: true }, limite: 8,
      justificativa: red === 'GRS'
        ? 'Backup com redundância geográfica (GRS) replica em outra região e protege contra desastre regional — custa mais por GB armazenado que o local.'
        : red === 'ZRS'
          ? 'Backup com redundância de zona (ZRS) protege contra perda de um datacenter dentro da mesma região.'
          : 'Backup com redundância local (LRS) é a opção mais econômica, suficiente quando não há exigência de proteção contra desastre regional.',
    }]
  },
}

const TIPO_BANDWIDTH: TipoRecursoDef = {
  id: 'bandwidth', titulo: 'Bandwidth', icone: '📡',
  descricao: 'Tráfego de saída (egress) — cobrado por GB que sai da Azure.',
  tipoServico: 'Networking',
  relacionados: [],
  perguntas: [
    // A pergunta de volume foi trocada pela preferência de roteamento porque o volume não tem
    // como filtrar nada: as faixas de preço por volume existem, mas a Azure publica todas com
    // o MESMO nome de meter ("Standard Data Transfer Out"), sem expor os limites das faixas.
    // Roteamento, por outro lado, é um produto diferente no catálogo — e muda o preço.
    { id: 'roteamento', tipo: 'opcoes', titulo: 'Qual preferência de roteamento da saída?', opcoes: [
      { valor: 'internet', label: 'Internet', descricao: 'mais barato — sai pelo provedor mais próximo (padrão)' },
      { valor: 'mgn', label: 'Rede global da Microsoft', descricao: 'trafega pelo backbone da Azure até o destino — mais caro, latência menor' },
    ] },
  ],
  gerarBuscas: (r) => {
    const mgn = r.roteamento === 'mgn'
    return [{
      categoria: 'Networking',
      produto: mgn ? 'Rtn Preference: MGN' : 'Bandwidth - Routing Preference: Internet',
      q: 'Data Transfer Out',
      // Sem excluir estes, o meter "Standard Inter-Availability Zone Data Transfer Out" (que
      // é tráfego entre zonas, não saída para a internet) também termina com "Data Transfer
      // Out" e, sendo o mais barato, assumiria o topo da lista.
      refino: { meterTerminaCom: 'Data Transfer Out', meterNaoContem: ['Inter-Availability', 'Inter-Region', 'China'], ordenarPorPreco: true }, limite: 8,
      justificativa: (mgn
        ? 'Roteamento pela rede global da Microsoft: o tráfego percorre o backbone da Azure até o ponto mais perto do destino, com latência menor e custo por GB mais alto.'
        : 'Roteamento pela internet: o tráfego sai pelo provedor mais próximo da região. É o padrão e o mais barato por GB.')
        + ' Entrada de dados na Azure é gratuita; só a saída é cobrada. O preço real cai por faixa de volume (os primeiros 100 GB/mês são grátis), mas a Azure publica todas as faixas com o mesmo nome de meter — por isso podem aparecer vários valores aqui, do mais barato (faixas de grande volume) ao mais caro (primeira faixa cobrada).',
    }]
  },
}

const TIPO_AKS: TipoRecursoDef = {
  id: 'aks', titulo: 'AKS (Kubernetes)', icone: '☸️',
  descricao: 'Gerenciamento do cluster — os nodes são VMs cobradas à parte.',
  tipoServico: 'Containers',
  relacionados: ['vm', 'disco', 'load-balancer', 'bandwidth'],
  perguntas: [
    { id: 'tier', tipo: 'opcoes', titulo: 'Qual tier de gerenciamento do cluster?', opcoes: [
      { valor: 'free', label: 'Free', descricao: 'dev/test — gerenciamento grátis, sem SLA financeiro' },
      { valor: 'standard', label: 'Standard', descricao: 'produção — taxa por hora, SLA de 99,9%' },
      { valor: 'premium', label: 'Premium', descricao: 'produção + suporte estendido (LTS)' },
    ] },
  ],
  // Meters reais do produto "Azure Kubernetes Service": a taxa do tier Standard é
  // "Standard Uptime SLA" (US$ 0,10/h) e a do Premium é "Standard Long Term Support"
  // (US$ 0,60/h). Vão sem filtro de região porque a Azure não publica esses meters para toda
  // região — existem em 114 regiões no catálogo, nenhuma delas brazilsouth — e o preço do
  // control plane é uniforme. Também sem `categoria`: o service_family desse produto no
  // catálogo não é 'Containers'.
  gerarBuscas: (r) => {
    const tier = String(r.tier || 'standard')
    if (tier === 'free') {
      return [{ categoria: '', q: '', semPreco: true, justificativa:
        'No tier Free a Azure não cobra pelo gerenciamento do cluster — não existe meter de preço para ele. O custo do AKS vem todo dos nodes (VMs), discos e rede, que o assistente sugere a seguir. Em troca, não há SLA financeiro da API do Kubernetes.' }]
    }
    const premium = tier === 'premium'
    return [{
      categoria: '', produto: 'Azure Kubernetes Service', ignorarRegiao: true, limite: 2,
      // O 'Standard' precisa estar no `q`, não só no refino: o meter "Uptime SLA" tem 114
      // linhas e a página 1 (50 linhas, ordem alfabética) é toda de
      // "FreeTierInfrastructureCost" — filtrar depois, no cliente, não alcançaria as linhas
      // certas, que ficam na página 3.
      q: premium ? 'Standard Long Term Support' : 'Standard Uptime SLA',
      refino: premium
        ? { meterContem: 'Long Term Support' }
        : { meterTerminaCom: 'Uptime SLA', meterNaoContem: ['FreeTier'] },
      justificativa: (premium
        ? 'Taxa fixa por hora do cluster no tier Premium, que soma o SLA do Standard ao suporte de longo prazo (LTS) das versões do Kubernetes.'
        : 'Taxa fixa por hora do cluster no tier Standard, em troca do SLA financeiro de 99,9% da API do Kubernetes.')
        + ' Os nodes continuam cobrados à parte, como VM. Atenção: a Azure não publica esse meter para a região escolhida — o valor vem de outra região, e para o gerenciamento do AKS ele é uniforme.',
    }]
  },
}

const TIPO_STORAGE: TipoRecursoDef = {
  id: 'storage', titulo: 'Storage (Blob)', icone: '📦',
  descricao: 'Conta de armazenamento para arquivos, backups e documentos.',
  tipoServico: 'Storage',
  relacionados: ['bandwidth'],
  perguntas: [
    { id: 'acesso', tipo: 'opcoes', titulo: 'Com que frequência os dados são acessados?', opcoes: [
      { valor: 'Hot', label: 'Frequente (todo dia)', descricao: 'Tier Hot — menor custo de acesso' },
      { valor: 'Cool', label: 'Ocasional (vezes por mês)', descricao: 'Tier Cool — equilíbrio' },
      { valor: 'Cold', label: 'Esporádico (poucas vezes ao ano)', descricao: 'Tier Cold — entre o Cool e o Archive' },
      { valor: 'Archive', label: 'Raro (arquivo longo prazo)', descricao: 'Tier Archive — menor custo por GB' },
    ] },
  ],
  // Meters do produto "General Block Blob v2" no formato "<Tier> <Redundância> Data Stored"
  // (1 GB/Month). O filtro por 'Data Stored' separa o armazenamento das operações, inventário,
  // recuperação e early delete, que são meters distintos do mesmo sku.
  // A redundância NÃO é perguntada de propósito: a matriz tier × redundância do catálogo é
  // esparsa e irregular (em brazilsouth o Hot não tem LRS, o Cool não tem RA-GRS, o Archive não
  // tem ZRS), então perguntar as duas coisas produziria combinações inexistentes. Em vez disso
  // listamos todas as redundâncias que existem para o tier escolhido, da mais barata pra mais
  // cara — o que também deixa a diferença de preço entre LRS/ZRS/GRS visível de uma vez.
  gerarBuscas: (r) => {
    const tier = String(r.acesso || 'Hot')
    const nota: Record<string, string> = {
      Hot: 'Tier Hot tem o menor custo de acesso — certo pra dados consultados com frequência, mesmo custando mais por GB armazenado.',
      Cool: 'Tier Cool equilibra custo de armazenamento e de acesso — bom pra dados consultados algumas vezes por mês (mínimo de 30 dias).',
      Cold: 'Tier Cold fica entre o Cool e o Archive: mais barato por GB, com mínimo de 90 dias e custo de leitura mais alto.',
      Archive: 'Tier Archive é o mais barato por GB armazenado, mas a recuperação leva horas, custa à parte e tem mínimo de 180 dias.',
    }
    return [{
      categoria: 'Storage', produto: 'General Block Blob v2', q: tier,
      refino: { meterTerminaCom: 'Data Stored', meterContem: tier, ordenarPorPreco: true }, limite: 8,
      justificativa: `${nota[tier]} Abaixo, as redundâncias disponíveis nesse tier, da mais barata pra mais cara:`
        + ' LRS mantém 3 cópias num datacenter, ZRS espalha por zonas da mesma região, GRS replica em outra região e os RA-* permitem leitura na secundária.',
    }]
  },
}

const TIPO_SQL: TipoRecursoDef = {
  id: 'sql', titulo: 'SQL Database', icone: '🗄️',
  descricao: 'Banco de dados gerenciado (PaaS) — sem VM pra administrar.',
  tipoServico: 'Databases',
  relacionados: ['backup'],
  perguntas: [
    { id: 'modelo', tipo: 'opcoes', titulo: 'Qual modelo de compra do banco?', opcoes: [
      { valor: 'dtu', label: 'DTU', descricao: 'pacote fechado de CPU+memória+IO, cobrado por dia — mais simples, bom pra cargas pequenas' },
      { valor: 'vcore', label: 'vCore', descricao: 'você escolhe os vCores, cobrado por hora — escala melhor e permite reserva' },
    ] },
    { id: 'tierDtu', tipo: 'opcoes', titulo: 'Qual tier DTU?', mostrarSe: (r) => r.modelo !== 'vcore', opcoes: [
      { valor: 'Basic', label: 'Basic', descricao: 'bancos pequenos, até 2 GB' },
      { valor: 'Standard', label: 'Standard', descricao: 'uso corporativo típico (S0 a S12)' },
      { valor: 'Premium', label: 'Premium', descricao: 'alta performance e IO intenso (P1 a P15)' },
    ] },
    { id: 'tierVcore', tipo: 'opcoes', titulo: 'Qual tier vCore?', mostrarSe: (r) => r.modelo === 'vcore', opcoes: [
      { valor: 'General Purpose', label: 'General Purpose', descricao: 'equilíbrio padrão de produção' },
      { valor: 'Business Critical', label: 'Business Critical', descricao: 'réplicas locais, menor latência, mais caro' },
    ] },
  ],
  // DTU: produto "SQL Database Single <Tier>", meters "S0 DTUs", "P1 DTUs"... na unidade 1/Day.
  // vCore: produto "SQL Database Single/Elastic Pool <Tier> - Compute Gen5", meter "vCore" por
  // hora. Em ambos excluímos 'Secondary', que são as réplicas de geo-replicação, não o banco.
  gerarBuscas: (r) => {
    if (r.modelo === 'vcore') {
      const tier = String(r.tierVcore || 'General Purpose')
      return [{
        categoria: 'Databases', produto: `SQL Database Single/Elastic Pool ${tier} - Compute Gen5`, q: 'vCore',
        refino: { meterContem: 'vCore', meterNaoContem: ['Secondary'], ordenarPorPreco: true }, limite: 10,
        justificativa: `Compute vCore no tier ${tier} (geração Gen5), cobrado por hora e por vCore. `
          + (tier === 'Business Critical'
            ? 'O Business Critical mantém réplicas locais e SSD local, entregando latência menor por um custo bem mais alto que o General Purpose.'
            : 'O General Purpose é o padrão de produção. Armazenamento e backup são cobrados à parte deste compute.'),
      }]
    }
    const tier = String(r.tierDtu || 'Standard')
    return [{
      categoria: 'Databases', produto: `SQL Database Single ${tier}`, q: 'DTUs',
      refino: { meterTerminaCom: 'DTUs', meterNaoContem: ['Secondary'], ordenarPorPreco: true }, limite: 12,
      justificativa: `Tier DTU ${tier}: cada tamanho (${tier === 'Premium' ? 'P1, P2, P4...' : tier === 'Basic' ? 'B' : 'S0, S1, S2...'}) é um pacote fechado de CPU, memória e IO. `
        + 'Atenção à unidade: estes meters são cobrados POR DIA, não por hora — a simulação já converte para o mês. Armazenamento e backup são cobrados à parte.',
    }]
  },
}

// Acesso direto ao catálogo, para tudo que não tem um tipo curado próprio. Os tipos acima
// cobrem os serviços mais comuns com pergunta guiada e filtro de meter validado à mão; este
// cobre o RESTO do catálogo (PostgreSQL, Redis, Databricks, Azure Monitor, OpenAI, Key Vault,
// App Service, Container Instances...) navegando categoria → produto → SKU. Sem ele, 61% dos
// produtos disponíveis na região ficariam inalcançáveis pelo assistente.
const TIPO_OUTRO: TipoRecursoDef = {
  id: 'outro', titulo: 'Outro serviço', icone: '🧩',
  descricao: 'Qualquer outro serviço do catálogo — Databricks, PostgreSQL, Redis, Monitor, OpenAI...',
  tipoServico: 'Catálogo',
  relacionados: [],
  // Sem perguntas: as respostas são preenchidas pela caixa de serviço que o usuário clicou na
  // tela de tipos (ver PriceSimWizard.tsx, `selecionarServico`), então o fluxo vai direto pro
  // resultado. `produtos` é a lista de product_name que compõem aquele serviço.
  perguntas: [],
  gerarBuscas: (r) => {
    const servico = String(r.servico || '')
    const produtos = String(r.produtos || '').split('|').filter(Boolean)
    if (!servico || produtos.length === 0) return []
    return [{
      categoria: '', q: '', produtos, limite: 30,
      refino: { ordenarPorPreco: true },
      justificativa: `Meters de ${servico} na região escolhida, do mais barato pro mais caro`
        + (produtos.length > 1 ? ` (${produtos.length} produtos do catálogo compõem esse serviço).` : '.')
        + ' Diferente dos tipos guiados, aqui não há pergunta nem filtro curado — confira a unidade de cobrança de cada linha antes de adicionar.',
    }]
  },
}

export const TIPOS_RECURSO: TipoRecursoDef[] = [
  TIPO_VM, TIPO_DISCO, TIPO_FIREWALL, TIPO_IP_PUBLICO, TIPO_LOAD_BALANCER,
  TIPO_BACKUP, TIPO_BANDWIDTH, TIPO_AKS, TIPO_STORAGE, TIPO_SQL, TIPO_OUTRO,
]

export function tipoPorId(id: string): TipoRecursoDef | undefined {
  return TIPOS_RECURSO.find((t) => t.id === id)
}

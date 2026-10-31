'use strict';

const texto = (value) => ({ type: 'text', text: value });
const paragrafo = (value) => ({ type: 'paragraph', content: [texto(value)] });
const titulo = (value, level = 2) => ({ type: 'heading', attrs: { level }, content: [texto(value)] });
const lista = (items) => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragrafo(item)] })),
});

module.exports = [
  {
    slug: 'acesso-e-perfis',
    titulo: 'Acesso e perfis do FinOps Manager',
    categoria: 'Primeiros passos',
    resumo: 'Entenda as formas de autenticação e o que cada perfil pode fazer.',
    conteudo: {
      type: 'doc',
      content: [
        paragrafo('O acesso ao FinOps Manager é individual. Use o método habilitado pela sua organização e não compartilhe sua sessão ou credenciais.'),
        titulo('Formas de entrar'),
        lista([
          'Login local: use o e-mail e a senha cadastrados no sistema.',
          'Active Directory: autentique com a conta corporativa quando o administrador tiver configurado a integração.',
          'Microsoft Entra ID: escolha a entrada Microsoft quando essa opção estiver habilitada para o ambiente.',
        ]),
        titulo('Perfis'),
        lista([
          'admin: administra usuários e configurações e tem acesso de edição à Wiki.',
          'finops: trabalha nas telas FinOps e pode criar, editar e publicar artigos da Wiki.',
          'reader: consulta os módulos liberados para leitura e vê somente artigos publicados na Wiki.',
        ]),
        paragrafo('Se uma tela ou ação não aparecer para seu perfil, solicite ao administrador a confirmação do acesso. A interface não substitui as permissões aplicadas pelo servidor.'),
      ],
    },
  },
  {
    slug: 'primeira-consulta-de-custos',
    titulo: 'Primeira consulta de custos no Portal',
    categoria: 'Calculadora',
    resumo: 'Selecione escopo e período para consultar custos de billing disponíveis.',
    conteudo: {
      type: 'doc',
      content: [
        paragrafo('A Calculadora de Custos usa dados de billing disponíveis no FinOps Manager. O resultado depende do escopo importado e das permissões configuradas para o Portal.'),
        titulo('Passo a passo'),
        { type: 'orderedList', content: [
          { type: 'listItem', content: [paragrafo('Selecione uma assinatura e confirme a seleção.') ] },
          { type: 'listItem', content: [paragrafo('Selecione os grupos de recursos que deseja analisar e confirme.') ] },
          { type: 'listItem', content: [paragrafo('Revise o período informado na tela; ajuste-o se necessário.') ] },
          { type: 'listItem', content: [paragrafo('Execute a busca e confira os recursos e valores retornados.') ] },
        ] },
        titulo('Se não encontrar dados'),
        lista([
          'Confirme se escolheu a assinatura e o grupo de recursos corretos.',
          'Verifique se o período consultado já foi importado ou coletado.',
          'Considere que uma assinatura ou grupo pode não estar liberado para o Portal; nesse caso, fale com o administrador.',
        ]),
        paragrafo('Use os resultados como leitura do billing disponível para o escopo consultado. Uma consulta vazia não comprova que o recurso seja gratuito.'),
      ],
    },
  },
  {
    slug: 'custos-de-reserva-e-amortizacao',
    titulo: 'Como interpretar custos de reservas e Savings Plans',
    categoria: 'Custos',
    resumo: 'Billing igual a zero em uma linha não significa necessariamente custo gratuito.',
    conteudo: {
      type: 'doc',
      content: [
        paragrafo('Uma reserva ou Savings Plan pode ser cobrada antecipadamente ou distribuída pelo Azure ao longo do uso. Por isso, o valor de billing de uma linha e o custo amortizado respondem a perguntas diferentes.'),
        titulo('O que observar'),
        lista([
          'Uma linha coberta por compromisso pode apresentar custo de billing igual a zero porque a compra foi registrada separadamente.',
          'Quando os dados da fatura incluem o preço efetivo, o FinOps Manager pode apresentar o custo amortizado correspondente ao uso.',
          'Não conclua que o recurso é gratuito olhando apenas uma linha ou um campo isolado.',
        ]),
        titulo('Ao comparar períodos'),
        paragrafo('Mantenha o mesmo escopo, moeda e critério de custo entre os períodos comparados. Para auditoria, confira o período da fatura e a origem do dado; valores de catálogo não substituem o custo faturado.'),
      ],
    },
  },
  {
    slug: 'acompanhar-reservas-cloud',
    titulo: 'Acompanhar reservas Cloud',
    categoria: 'Reservas',
    resumo: 'Consulte escopo, vigência e origem dos registros de reservas.',
    conteudo: {
      type: 'doc',
      content: [
        paragrafo('A tela Reservas Cloud reúne registros de reservas e Savings Plans para acompanhamento de vigência e escopo.'),
        titulo('O que conferir em cada registro'),
        lista([
          'Cloud e tipo de compromisso, para distinguir a origem e o modelo da reserva.',
          'Escopo de aplicação, como assinatura ou grupo de recursos, quando disponível.',
          'Data de início, vencimento, status e origem do dado.',
        ]),
        titulo('Atualização dos dados'),
        paragrafo('Uma reserva pode chegar por cadastro manual, sincronização com a Azure ou importação de relatório, conforme os caminhos habilitados no ambiente. Ao importar, confirme a origem e evite criar manualmente um registro já sincronizado.'),
        paragrafo('Quando houver divergência, valide primeiro o identificador, o escopo e as datas no relatório de origem. A forma de atualização disponível depende da origem do registro.'),
      ],
    },
  },
  {
    slug: 'avaliar-recursos-orfaos',
    titulo: 'Avaliar recursos identificados como órfãos',
    categoria: 'Inventário',
    resumo: 'Valide uso, escopo e custo antes de abrir uma ação de remoção.',
    conteudo: {
      type: 'doc',
      content: [
        paragrafo('A identificação de um recurso como órfão é um indício para análise, não uma autorização automática para excluí-lo. Confirme com o responsável pela aplicação antes de qualquer ação.'),
        titulo('Checklist de avaliação'),
        { type: 'orderedList', content: [
          { type: 'listItem', content: [paragrafo('Confirme assinatura, grupo de recursos, tipo e identificador do recurso.') ] },
          { type: 'listItem', content: [paragrafo('Verifique vínculos, dependências e atividade recente; alguns recursos podem ter função operacional que não é evidente pela tela.') ] },
          { type: 'listItem', content: [paragrafo('Confira o custo no billing e o período analisado. Ausência de custo identificado não prova custo zero.') ] },
          { type: 'listItem', content: [paragrafo('Registre a validação e obtenha aprovação do responsável antes de solicitar a exclusão.') ] },
        ] },
        paragrafo('A economia realizada no FinOps Manager é uma métrica auditável e segue critérios próprios de identificação, faturamento e exclusão. Consulte o detalhe do recurso e não estime economia apenas pelo preço de catálogo.'),
      ],
    },
  },
];
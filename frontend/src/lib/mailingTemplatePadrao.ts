// Modelo padrão de Comunicado FinOps — reconstruído a partir do .msg real que o time já
// usa (2026-10-16, pedido do usuário: "se eu te mandar um modelo que usamos hoje vc
// consegue implementar?"). Reconstruído como HTML limpo, não importado literal do
// Outlook (decisão já registrada no plano do Mailing: o HTML do Outlook é sujo demais
// pra editar depois — isso aqui é a MESMA aparência, compatível com o schema do TipTap).
//
// Simplificação deliberada: a assinatura original tinha o logo e o texto lado a lado
// numa tabela — o editor (StarterKit, sem extensão de tabela) não preserva layout de
// tabela/flex ao carregar o HTML, então a assinatura aqui é logo em cima, texto embaixo.
// Mesmo conteúdo, só não o mesmo layout lado a lado.
//
// Imagens de marca (banner + logo) ficam em /mailing_uploads/, servidas estaticamente —
// mesmo mecanismo que as imagens que o usuário sobe pelo composer, só que com nome fixo
// em vez de timestamp, porque são reaproveitadas em todo comunicado, não de um upload só.
//
// Tamanho do logo via atributo `width`, não `style` (2026-10-16 — redesenho da
// assinatura): o editor descarta `style` solto de imagem/cor ao carregar HTML pronto,
// só preserva o que a extensão configurada em MailingComposer.tsx entende — `width` é
// um desses (ver ImageComTamanho ali) e também é mais respeitado entre clientes de
// e-mail que CSS de tamanho. Roxo de título/divisória vem do PADRÃO da extensão
// (MailingComposer.tsx), não pintado aqui por instância — por isso sobrevive.
export function buildTemplatePadraoFinOps(): string {
  const base = window.location.origin
  return `
<p style="text-align:center"><img src="${base}/mailing-uploads/finops-banner-comunicado.png" alt="Comunicado FinOps" style="max-width:100%;height:auto"></p>
<p>Olá, pessoal!</p>
<p>Com o objetivo de fortalecer a governança dos ambientes em nuvem e otimizar os custos de infraestrutura, estamos reforçando o processo de identificação e tratamento de recursos órfãos nos provedores de cloud <strong>Azure, Google Cloud Platform (GCP) e Oracle Cloud Infrastructure (OCI)</strong>.</p>
<p>Esse processo será conduzido em conjunto pelas equipes de <strong>FinOps</strong> e <strong>Cloud Engineer</strong>, que realizarão, de forma periódica, o monitoramento de recursos de armazenamento e demais componentes sem utilização ou sem associação a recursos ativos. A iniciativa visa garantir maior controle dos ativos em nuvem, aumentar a eficiência operacional e promover o uso adequado dos recursos contratados.</p>
<h3>Como funcionará o processo?</h3>
<ul>
<li>✅ Identificação periódica de recursos sem utilização pelas equipes de Cloud Engineer e FinOps;</li>
<li>✅ Disponibilização de relatório para validação dos responsáveis pelos recursos identificados;</li>
<li>✅ Criação de <strong>snapshot</strong> dos discos identificados, com retenção de <strong>90 dias</strong>, antes da exclusão definitiva;</li>
<li>✅ Para os demais recursos que não suportam snapshot, como <strong>IPs públicos, Load Balancers, Interfaces de Rede (NICs)</strong>, entre outros, será aplicado um período de retenção de <strong>90 dias</strong> antes da exclusão definitiva;</li>
<li>✅ Remoção definitiva dos snapshots e demais recursos após o prazo de retenção de 90 dias, impossibilitando a recuperação dos dados.</li>
</ul>
<h3>O que é esperado dos times?</h3>
<p>Sempre que uma nova relação de recursos órfãos for disponibilizada, os responsáveis deverão analisar os itens apontados e informar à equipe de FinOps caso exista a necessidade de manter o recurso ou preservar seus dados.</p>
<p>A ausência de manifestação dentro do prazo informado será considerada como aprovação para a continuidade do processo de exclusão.</p>
<h3>Benefícios do processo</h3>
<ul>
<li>✔ Redução de custos relacionados a recursos sem utilização;</li>
<li>✔ Maior eficiência na gestão dos ambientes cloud;</li>
<li>✔ Padronização do tratamento de recursos órfãos;</li>
<li>✔ Aumento da governança e da rastreabilidade dos ativos em nuvem;</li>
<li>✔ Melhor aproveitamento dos recursos contratados.</li>
</ul>
<h3>Consulta dos recursos identificados</h3>
<p>🔗 Acesse a planilha/link de acompanhamento e valide os recursos sob sua responsabilidade: <a href="#">[cole aqui o link da planilha/relatório]</a></p>
<p>Solicitamos que a validação seja realizada dentro do prazo informado, a fim de evitar a exclusão de recursos necessários às operações. Caso seja identificada a necessidade de retenção de algum recurso, favor comunicar imediatamente as equipes de Cloud Engineer e FinOps por meio de RITM "<a href="#">[cole aqui o link do RITM]</a>".</p>
<h3>Dúvidas e suporte</h3>
<p>Em caso de dúvidas ou necessidade de suporte, entre em contato com as equipes responsáveis:</p>
<p><strong>📧 finops.br@telefonica.com</strong></p>
<hr>
<p><img src="${base}/mailing-uploads/finops-logo-assinatura.png" alt="FinOps" width="90"></p>
<h3>Equipe FinOps</h3>
<p><strong>Diretoria de Infraestrutura e Cloud</strong><br>
<strong>Telefônica Brasil | Vivo</strong></p>
<p>✉ <a href="mailto:finops.br@telefonica.com">finops.br@telefonica.com</a></p>
<p style="text-align:center"><strong><u>Este é um e-mail automático. Por favor não responda</u></strong></p>
`.trim()
}

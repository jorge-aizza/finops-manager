// Modelo padrão de Comunicado FinOps — reconstruído a partir do .msg real que o time já
// usa (2026-10-16, pedido do usuário: "se eu te mandar um modelo que usamos hoje vc
// consegue implementar?"). Reconstruído como HTML limpo, não importado literal do
// Outlook (decisão já registrada no plano do Mailing: o HTML do Outlook é sujo demais
// pra editar depois — isso aqui é a MESMA aparência, compatível com o schema do TipTap).
//
// Assinatura em tabela de 2 colunas (2026-10-17, pedido do usuário: "quero o texto na
// frente da imagem como o MSG consegue") — igual ao .msg original. Precisou adicionar
// suporte a tabela no editor (MailingComposer.tsx) pra isso sobreviver ao carregar o
// modelo; sem extensão de tabela, imagem e texto nunca ficam lado a lado (a extensão de
// imagem é bloco, quebra pro próprio parágrafo sempre — confirmado testando antes de
// escrever este comentário, não é suposição).
//
// Imagens de marca (banner + logo) ficam em /mailing_uploads/, servidas estaticamente —
// mesmo mecanismo que as imagens que o usuário sobe pelo composer, só que com nome fixo
// em vez de timestamp, porque são reaproveitadas em todo comunicado, não de um upload só.
//
// Tamanho do logo via atributo `width`, não `style`: o editor descarta `style` solto de
// imagem/cor ao carregar HTML pronto, só preserva o que a extensão configurada em
// MailingComposer.tsx entende — `width` é um desses (ver ImageComTamanho ali) e também
// é mais respeitado entre clientes de e-mail que CSS de tamanho. Roxo dos títulos de
// seção (ex: "Como funcionará o processo?") vem do PADRÃO da extensão de heading em
// MailingComposer.tsx, não pintado aqui por instância — por isso sobrevive.
//
// Assinatura (ajustada pelo usuário pra ficar fiel ao .msg original): logo 120px (perto
// do 131px original), sem título extra nem divisória — só o que estava no e-mail de
// verdade. "Equipe FinOps"/emoji de envelope/linha divisória do primeiro rascunho foram
// tirados por pedido do usuário. Logo com fundo transparente (2026-10-17) — a imagem
// original tinha fundo branco sólido (não combinava com fundo escuro); removido por
// flood-fill a partir das bordas, preservando as cores do desenho.
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
<table>
<tbody>
<tr>
<td><img src="${base}/mailing-uploads/finops-logo-assinatura.png" alt="FinOps" width="120"></td>
<td><p><strong>Diretoria de Infraestrutura e Cloud</strong><br>
<strong>Telefônica Brasil | Vivo</strong><br>
<a href="mailto:finops.br@telefonica.com">finops.br@telefonica.com</a></p></td>
</tr>
</tbody>
</table>
<p style="text-align:center"><strong><u>Este é um e-mail automático. Por favor não responda</u></strong></p>
`.trim()
}

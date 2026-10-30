# 13-MAILING — Comunicados corporativos (broadcast)

Broadcast corporativo com cadastro único de contatos, editor visual (TipTap) e acompanhamento
por destinatário. **Separado dos Alertas**: transporte próprio, layout próprio, tabelas próprias.

## Peças principais

| O quê | Onde |
|---|---|
| Transporte: relay SMTP anônimo, autorizado por IP (sem senha) | `integracoes` tipo `mailing_relay` |
| Envio — ponto único da campanha e do envio de teste | `_sendMailingEmail()` |
| Imagens embutidas como anexo `cid:` | `_mailingEmbutirImagens()` |
| Envelope do corpo + rodapé de descadastro | `_mailingEmailEnvelope()` |
| Disparo em lote, em background, com progresso consultável | `_executarEnvioCampanha()`, `_mailingEnviosEmExecucao` (Map) |
| Tamanho/intervalo do lote | `_MAILING_LOTE_TAMANHO` (20), `_MAILING_LOTE_INTERVALO_MS` (2s) |
| Públicos | Grupos reutilizáveis + seleção individual no momento do envio; opt-outs sempre excluídos |
| Tabelas | `mailing_contatos`, `mailing_grupos`, `mailing_grupo_contatos`, `mailing_campanhas`, `mailing_envio_destinatario`, `mailing_templates`, `mailing_import_lote` |
| Imagens de marca (versionadas — precisam ir no deploy) | `mailing_uploads/`, servidas em `/mailing-uploads` |
| Template padrão, embutido no frontend | `buildTemplatePadraoFinOps()` (`frontend/src/lib/mailingTemplatePadrao.ts`) |

O relay do Mailing é **separado do SMTP de Alertas** por decisão registrada. Consequência
prática: o "Testar Conexão" pode falhar na estação e funcionar em produção, porque a liberação
é por IP de origem — não é configuração errada.

## Grupos e seleção de público

- Um contato pode pertencer a vários grupos (`mailing_grupo_contatos`); excluir um grupo não
	exclui os contatos. Membros são contatos do Mailing, não contas de login do FinOps Manager.
- Importar para um grupo aceita CSV e Excel `.xlsx` de até 20 MB, com cabeçalho de e-mail
	obrigatório e nome opcional. A importação faz upsert dos contatos e acrescenta os vínculos;
	não remove membros que já estavam no grupo. E-mails repetidos no mesmo arquivo são processados
	uma vez; status `opt_out` existente é preservado.
- A seleção fica salva em `mailing_campanhas.destinatarios` junto com o rascunho. No disparo,
	a interface abre essa seleção para revisão e envia `grupo_ids`, `contato_ids` e, opcionalmente,
	`todos_ativos`. A expansão é deduplicada no banco. Apenas contatos com `status='ativo'` entram,
	inclusive quando o grupo ainda contém alguém que pediu descadastro.
- `mailing_envio_destinatario` é o snapshot imutável do público no momento do disparo; mudanças
	posteriores nos membros de grupos não alteram a campanha já enviada. O reenvio de falhas usa
	esse mesmo snapshot.
- Uma seleção explícita sem contatos ativos é recusada. Requisições antigas sem os campos de
	seleção mantêm o comportamento anterior de enviar para todos os contatos ativos; na interface,
	essa opção aparece como escolha explícita "Todos os contatos ativos".

## Armadilhas

**Linhas vazias e quebras finais precisam existir no HTML enviado.** O editor TipTap usa
elementos auxiliares que não fazem parte do conteúdo salvo, e a prévia os reproduz com CSS.
`_mailingEmailEnvelope()` acrescenta espaços não separáveis a blocos vazios e a blocos
terminados em `<br>`, sem modificar o rascunho. Isso vale para envios de teste e campanhas.

**Imagem em e-mail NUNCA vai por URL — vai embutida (`cid:`).**
O corpo do comunicado sai do editor com `src="http://<host-do-finops>/mailing-uploads/x.png"`,
montado no navegador a partir de `window.location.origin`. Isso obriga o cliente de e-mail a
ALCANÇAR este servidor na hora de abrir — e no Outlook Web e no celular quem busca a imagem é o
proxy da Microsoft, que não tem rota para host interno. O sintoma é ícone de imagem quebrada, e
marcar o remetente como confiável NÃO resolve: confiar só autoriza o download, não cria rota.
`_mailingEmbutirImagens()` troca todo `src` de `/mailing-uploads/` por anexo `cid:` dentro de
`_sendMailingEmail()` — ponto único, vale para a campanha e para o envio de teste. Deixa em paz
URL externa, `data:` e arquivo que sumiu do disco (URL quebrada é melhor que envio que falha).
Consequência de peso: o arquivo vai em CADA mensagem, então imagem de template é dimensionada
para o e-mail (banner 1280px JPG, 62 KB) e não no tamanho original (era PNG 1920px, 1 MB — dava
1,1 MB por destinatário, ~556 MB num disparo para 500). O `.png` continua versionado porque
campanhas já salvas no banco apontam para ele.

---

See **07-EMAIL-ALERTS.md** for the Alerts transport, which is a separate one with its own layout.

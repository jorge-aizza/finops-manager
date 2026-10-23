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
| Tabelas | `mailing_contatos`, `mailing_campanhas`, `mailing_envio_destinatario`, `mailing_templates`, `mailing_import_lote` |
| Imagens de marca (versionadas — precisam ir no deploy) | `mailing_uploads/`, servidas em `/mailing-uploads` |
| Template padrão, embutido no frontend | `buildTemplatePadraoFinOps()` (`frontend/src/lib/mailingTemplatePadrao.ts`) |

O relay do Mailing é **separado do SMTP de Alertas** por decisão registrada. Consequência
prática: o "Testar Conexão" pode falhar na estação e funcionar em produção, porque a liberação
é por IP de origem — não é configuração errada.

## Armadilhas

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

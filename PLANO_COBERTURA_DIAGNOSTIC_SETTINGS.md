# Plano de cobertura de Diagnostic Settings

## Objetivo

Atingir e demonstrar 100% de cobertura dos Diagnostic Settings em todos os recursos suportados e dentro das assinaturas explicitamente cadastradas para coleta. A coleta nao deve ser marcada como completa quando houver assinatura, pagina ou recurso elegivel sem resultado confirmado.

Nao e possivel garantir cobertura de recursos fora do escopo, tipos sem suporte na API da Azure, assinaturas sem acesso ou recursos que deixaram de existir. Esses casos devem ser identificados e reportados separadamente, sem serem apresentados como sucesso.

## Linha de base observada

Na execucao de 19/10/2026, apos o restart do servico:

- 74 tipos de recursos estavam na lista monitorada.
- 7.232 recursos foram encontrados como candidatos; 7.224 foram consultados e 9 retornaram como inexistentes.
- 781 configuracoes foram armazenadas.
- 33 consultas falharam: timeouts, tipos nao suportados, providers nao registrados, um erro de autorizacao e um erro interno da Azure.
- A rotina consulta recursos por Service Principal e substitui a tabela de resultados ao final. A cobertura deve ser validada por assinatura antes de publicar um novo snapshot.

## Etapas

### 1. Fixar o escopo esperado

- Gerar uma lista de assinaturas e workspaces que devem participar da coleta.
- Comparar essa lista com os escopos associados as Service Principals ativas.
- Registrar explicitamente assinaturas fora do escopo e tipos de recurso nao suportados; nao os contar como recursos cobertos.
- Confirmar se a lista atual de 74 tipos cobre os tipos existentes no inventario e adicionar os tipos suportados que estiverem faltando.

**Entrega:** inventario versionado do escopo e dos tipos monitorados, com motivo para cada exclusao.

### 2. Corrigir acesso e configuracao Azure

- Conceder as Service Principals leitura do Resource Graph e de Diagnostic Settings em todas as assinaturas do escopo.
- Corrigir o `AuthorizationFailed` observado para o workspace Databricks, confirmando o principal e o escopo da role.
- Registrar os resource providers ausentes apontados por `SubscriptionNotRegistered` e repetir a consulta.
- Validar as permissoes com uma chamada de leitura por assinatura antes da coleta completa.

**Entrega:** verificacao automatizada de acesso por Service Principal e assinatura, com resultado legivel por escopo.

### 3. Tornar a coleta segura contra resultados parciais

- Alterar a consulta para devolver resultados e erros estruturados por Service Principal e assinatura; nao absorver uma falha como se fosse uma lista vazia.
- Guardar, por assinatura, se a descoberta do Resource Graph terminou todas as paginas.
- So publicar o novo snapshot quando todos os escopos elegiveis tiverem sido processados com sucesso. Em caso de falha, manter os dados anteriores e marcar a execucao como parcial.
- Fazer a publicacao em transacao, incluindo os resultados e o estado da execucao.
- Tratar `404` de recurso removido como item encerrado, registrando-o sem classifica-lo como erro de permissao.

**Entrega:** nenhuma falha de uma Service Principal pode apagar resultados validos de outra assinatura nem substituir o snapshot completo por dados parciais.

### 4. Tratar falhas transitorias e limites

- Aplicar retry com backoff e jitter para timeout, `429` e respostas `5xx`, respeitando `Retry-After` quando presente.
- Manter concorrencia limitada para nao sobrecarregar a Azure; registrar tentativas e resultado final.
- Detectar explicitamente limite de paginas ou resposta truncada do Resource Graph. Uma consulta truncada nao pode ser considerada completa.
- Tirar da lista de consultas os tipos confirmados como `ResourceTypeNotSupported`, mas manter uma verificacao periodica para identificar mudancas de suporte.

**Entrega:** toda falha fica como resolvida, nao suportada ou pendente de retry; nenhuma e descartada silenciosamente.

### 5. Registrar cobertura e alertar

Para cada execucao, registrar:

- inicio, fim, duracao, gatilho (agendada ou manual) e status geral;
- assinaturas e Service Principals esperadas, concluidas e com falha;
- paginas do Resource Graph, recursos candidatos, consultados e removidos/inexistentes;
- Diagnostic Settings encontrados por workspace e destino;
- falhas por codigo Azure, tipo de recurso e assinatura;
- versao da lista de tipos monitorados.

Exibir um resumo de cobertura e alertar quando houver escopo sem resultado, falha acionavel ou coleta parcial. A coleta semanal e o disparo manual devem reportar o status final, nao apenas que a execucao foi iniciada.

**Entrega:** historico de execucoes auditavel e alerta para qualquer cobertura incompleta.

### 6. Validar e liberar gradualmente

1. Testar a classificacao de sucesso, parcial, falha, `404`, tipo nao suportado e erro de permissao.
2. Executar primeiro em uma assinatura piloto e comparar a contagem com a consulta direta na Azure.
3. Executar em todas as assinaturas, reconciliar por workspace e investigar cada falha pendente.
4. Liberar a nova rotina mantendo o snapshot anterior disponivel para rollback.
5. Acompanhar pelo menos duas execucoes agendadas completas antes de considerar a meta estabilizada.

## Criterios de aceite

- 100% das assinaturas declaradas no escopo concluem descoberta e consulta, sem paginas pendentes.
- 100% dos recursos existentes dos tipos suportados recebem resposta da API de Diagnostic Settings; resposta vazia valida conta como consultada.
- Cada Diagnostic Setting retornado e atribuido ao workspace conhecido ou registrado como destino externo elegivel.
- Nao ha erros de permissao, provider nao registrado, timeout ou erro temporario sem resolucao. Tipos nao suportados e recursos removidos estao classificados e visiveis.
- Uma execucao parcial nunca substitui nem apaga o snapshot da ultima execucao completa.
- O painel/log mostra denominador, numerador, percentual e pendencias por assinatura e workspace.

## Operacao

- Manter a coleta agendada semanalmente e permitir acionamento manual.
- Ao ocorrer uma falha, preservar o ultimo snapshot completo, alertar e permitir retry apenas dos escopos pendentes.
- Revisar a lista de tipos monitorados quando novos tipos aparecerem no inventario ou a Azure passar a suportar novos Diagnostic Settings.
- Nao declarar cobertura universal: o indicador de 100% sempre deve exibir o escopo e a lista de tipos aos quais se aplica.
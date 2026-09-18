# -*- coding: utf-8 -*-
"""
Recalcula as colunas derivadas de dados_modelo_validacao.csv SEM alterar o layout.

Preserva exatamente: as 22 colunas, a ordem, os nomes do cabecalho, a quebra de
linha CRLF e o newline final -- o cockpit-quotas-v51.html continua lendo o
arquivo sem nenhuma alteracao no HTML.

Recalcula 6 colunas a partir das linhas de consumo (a unica fonte de verdade
auditavel do arquivo):
    custo_usd_total_workspace   <- SUM(custo_usd) por (workspace, mes)
    custo_usd_total_usuario     <- SUM(custo_usd) por (usuario, workspace, mes)
    pct_quota_ws                <- total_workspace / quota_ws_usd * 100
    pct_limite_per_user         <- total_usuario   / limite_per_user_usd * 100
    status_quota_ws             <- faixa de pct_quota_ws
    status_per_user             <- faixa de pct_limite_per_user

NAO toca em: usage_date, mes_referencia, workspace_*, sku_name, produto,
usuario, endpoint_name, cluster_id, total_dbus, preco_unitario_usd, custo_usd,
NOME_BUDGET, quota_ws_usd, limite_per_user_usd, tipo_limite_per_user.
"""
import csv, io, sys, os
from collections import defaultdict

ENTRADA = 'dados_modelo_validacao.csv'
SAIDA   = 'dados_modelo_validacao_corrigido.csv'

# Acima deste percentual a linha e marcada como bloqueada. 95 reproduz o
# rotulo observado no arquivo original (bloqueado 96-99, dentro ate 94,2).
LIMIAR_BLOQUEIO = 95.0

# Escopo do limite per-user. No arquivo original o valor de limite_per_user_usd
# acompanha o WORKSPACE, nao o usuario (ana.silva tem 800 em ws-analytics-prod
# e 1200 em ws-ml-training no mesmo mes) -- logo o consumo comparado contra ele
# tem de ser o consumo daquele usuario NAQUELE workspace.
#   'workspace' -> SUM por (usuario, workspace, mes)   [padrao, correto aqui]
#   'global'    -> SUM por (usuario, mes)
ESCOPO_USUARIO = 'workspace'

ST_WS_SEM   = 'Sem quota definida'
ST_WS_OK    = 'Dentro da Quota (workspace)'
ST_WS_BLOQ  = 'Bloqueado (workspace)'
ST_US_SEM   = 'Sem limite per-user'
ST_US_OK    = 'Dentro da Quota (usu\u00e1rio)'
ST_US_BLOQ  = 'Bloqueado (usu\u00e1rio)'

DERIVADAS = ['custo_usd_total_workspace', 'custo_usd_total_usuario',
             'pct_quota_ws', 'pct_limite_per_user',
             'status_quota_ws', 'status_per_user']


def num(v):
    v = (v or '').strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def main():
    if not os.path.exists(ENTRADA):
        sys.exit('Arquivo nao encontrado: ' + ENTRADA)

    # newline='' preserva os campos crus; o cabecalho e reaproveitado verbatim.
    with io.open(ENTRADA, encoding='utf-8', newline='') as fh:
        leitor = csv.DictReader(fh)
        colunas = list(leitor.fieldnames)
        linhas = list(leitor)

    faltando = [c for c in DERIVADAS if c not in colunas]
    if faltando:
        sys.exit('Colunas ausentes no arquivo de entrada: ' + ', '.join(faltando))

    # --- agregacao: a fonte de verdade sao as linhas de consumo ---
    tot_ws = defaultdict(float)
    tot_us = defaultdict(float)
    for r in linhas:
        c = num(r['custo_usd']) or 0.0
        tot_ws[(r['workspace_id'], r['mes_referencia'])] += c
        if ESCOPO_USUARIO == 'global':
            tot_us[(r['usuario'], r['mes_referencia'])] += c
        else:
            tot_us[(r['usuario'], r['workspace_id'], r['mes_referencia'])] += c

    mud = defaultdict(int)
    for r in linhas:
        kw = (r['workspace_id'], r['mes_referencia'])
        ku = ((r['usuario'], r['mes_referencia']) if ESCOPO_USUARIO == 'global'
              else (r['usuario'], r['workspace_id'], r['mes_referencia']))
        cw, cu = tot_ws[kw], tot_us[ku]
        quota = num(r['quota_ws_usd'])
        limite = num(r['limite_per_user_usd'])

        antes = {c: r[c] for c in DERIVADAS}

        # 'fixed4' e o tipo que o cockpit declara para estas duas colunas.
        r['custo_usd_total_workspace'] = '%.4f' % cw
        r['custo_usd_total_usuario']   = '%.4f' % cu

        if quota:
            pw = cw / quota * 100.0
            r['pct_quota_ws'] = '%.1f' % pw
            r['status_quota_ws'] = ST_WS_BLOQ if pw >= LIMIAR_BLOQUEIO else ST_WS_OK
        else:
            # Sem cota configurada nao existe percentual -- campo vazio, nunca 0.
            r['pct_quota_ws'] = ''
            r['status_quota_ws'] = ST_WS_SEM

        if limite:
            pu = cu / limite * 100.0
            r['pct_limite_per_user'] = '%.1f' % pu
            r['status_per_user'] = ST_US_BLOQ if pu >= LIMIAR_BLOQUEIO else ST_US_OK
        else:
            r['pct_limite_per_user'] = ''
            r['status_per_user'] = ST_US_SEM

        for c in DERIVADAS:
            if antes[c] != r[c]:
                mud[c] += 1

    # CRLF + newline final, iguais ao arquivo de entrada.
    with io.open(SAIDA, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=colunas, lineterminator='\r\n')
        w.writeheader()
        w.writerows(linhas)

    print('Gravado: %s  (%d linhas, %d colunas)' % (SAIDA, len(linhas), len(colunas)))
    print('Escopo do limite per-user: %s | limiar de bloqueio: %.1f%%' %
          (ESCOPO_USUARIO, LIMIAR_BLOQUEIO))
    print('\nCelulas alteradas por coluna:')
    for c in DERIVADAS:
        print('  %-28s %3d/%d' % (c, mud[c], len(linhas)))


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
Gera dados_cenarios_borda.csv -- massa de teste que exercita as faixas que a
base real (dados_modelo_validacao_corrigido.csv) nunca alcanca.

NAO substitui a base real: e um arquivo separado, com o MESMO layout (22
colunas, mesma ordem, CRLF, UTF-8), para ser carregado no cockpit quando o
objetivo for testar a UI em vez de olhar consumo verdadeiro.

Diferenca essencial em relacao ao arquivo original: aqui os percentuais sao
DERIVADOS das linhas de consumo, nunca escritos a mao. Cada cenario define a
cota e o percentual-alvo; o consumo e construido para produzir exatamente esse
percentual, e o percentual gravado e recalculado a partir do consumo. Se o
alvo e o derivado divergirem, o script falha em vez de gravar.

Limiares do cockpit (cockpit-quotas-v51.html):
    >90 vermelho | 71-90 amarelo | <=70 verde
    texto contendo "bloqueado" -> vermelho sempre, ignorando o percentual
    sem percentual -> cinza / "sem quota"
"""
import csv
import io
from collections import defaultdict
from decimal import Decimal as D

SAIDA = 'dados_cenarios_borda.csv'
LIMIAR_BLOQUEIO = D('95')

COLUNAS = ['usage_date', 'mes_referencia', 'workspace_name', 'workspace_id',
           'sku_name', 'produto', 'usuario', 'endpoint_name', 'cluster_id',
           'total_dbus', 'preco_unitario_usd', 'custo_usd', 'NOME_BUDGET',
           'quota_ws_usd', 'limite_per_user_usd', 'tipo_limite_per_user',
           'custo_usd_total_workspace', 'custo_usd_total_usuario',
           'pct_quota_ws', 'pct_limite_per_user',
           'status_quota_ws', 'status_per_user']

ST_WS_SEM = 'Sem quota definida'
ST_WS_OK = 'Dentro da Quota (workspace)'
ST_WS_BLOQ = 'Bloqueado (workspace)'
ST_US_SEM = 'Sem limite per-user'
ST_US_OK = 'Dentro da Quota (usuário)'
ST_US_BLOQ = 'Bloqueado (usuário)'

# id, workspace, budget, quota, limite_user, pct_ws_alvo, pct_userA, sku, produto, o_que_testa
CENARIOS = [
    ('ws-9001', 'ws-borda-verde', 'Budget-Borda-Verde',
     D('5000'), D('2000'), D('60'), D('60'), 'sql-compute', 'SQL',
     'verde folgado'),
    ('ws-9002', 'ws-borda-amarelo-ini', 'Budget-Borda-AmareloIni',
     D('4000'), D('2000'), D('70'), D('70'), 'jobs-compute', 'JOBS',
     'fronteira exata verde->amarelo (70)'),
    ('ws-9003', 'ws-borda-amarelo', 'Budget-Borda-Amarelo',
     D('4000'), D('2000'), D('82'), D('82'), 'dlt-compute', 'DLT',
     'meio da faixa amarela'),
    ('ws-9004', 'ws-borda-vermelho-ini', 'Budget-Borda-VermIni',
     D('4000'), D('2000'), D('90'), D('90'), 'ml-compute', 'ML',
     'fronteira exata amarelo->vermelho (90)'),
    ('ws-9005', 'ws-borda-vermelho', 'Budget-Borda-Vermelho',
     D('4000'), D('2000'), D('93'), D('93'), 'sql-compute', 'SQL',
     'vermelho SEM bloqueio'),
    ('ws-9006', 'ws-borda-bloq-limite', 'Budget-Borda-BloqLim',
     D('4000'), D('2000'), D('95'), D('95'), 'genie-compute', 'GENIE',
     'limiar exato de bloqueio (95)'),
    ('ws-9007', 'ws-borda-bloqueado', 'Budget-Borda-Bloqueado',
     D('2000'), D('1000'), D('98'), D('98'), 'ml-compute', 'ML',
     'bloqueado'),
    ('ws-9008', 'ws-borda-estourado', 'Budget-Borda-Estourado',
     D('1200'), D('600'), D('243'), D('243'), 'jobs-compute', 'JOBS',
     'acima de 100% (exemplo citado no cockpit)'),
    ('ws-9009', 'ws-borda-user-estoura', 'Budget-Borda-UserEst',
     D('9000'), D('300'), D('12'), D('180'), 'dlt-compute', 'DLT',
     'workspace verde + usuario estourado'),
    ('ws-9010', 'ws-borda-sem-quota', '',
     None, None, None, None, 'jobs-compute', 'JOBS',
     'sem quota e sem limite per-user'),
]

PRECO = D('0.50')          # divide exato -> dbus limpo, custo sem residuo
DATAS = ['2026-09-01', '2026-09-02', '2026-09-03']
USER_A = 'carlos.mendes@empresa.com'
USER_B = 'paula.dias@empresa.com'


def dec(v, casas):
    return str(v.quantize(D(1).scaleb(-casas)))


def status(pct, bloq, ok, sem):
    if pct is None:
        return sem
    return bloq if pct >= LIMIAR_BLOQUEIO else ok


def montar_linhas():
    linhas = []
    resumo = []
    for (wsid, wsnome, budget, quota, limite,
         pct_ws, pct_ua, sku, produto, testa) in CENARIOS:

        if quota is None:                    # consumo real existe, cota nao
            tot = {USER_A: D('120'), USER_B: D('60')}
        else:
            total_ws = quota * pct_ws / 100
            ta = limite * pct_ua / 100
            tb = total_ws - ta
            if tb < 0:
                raise SystemExit(
                    'usuario A consome mais que o workspace em ' + wsnome)
            tot = {USER_A: ta, USER_B: tb}

        # 3 linhas por usuario, datas distintas -> o total e de fato uma SOMA
        for usuario, alvo in tot.items():
            if alvo == 0:
                continue
            partes = [alvo / 3, alvo / 3, alvo - 2 * (alvo / 3)]
            for data, custo in zip(DATAS, partes):
                custo = custo.quantize(D('0.0001'))
                dbus = (custo / PRECO).quantize(D('0.0001'))
                custo = (dbus * PRECO).quantize(D('0.0001'))
                linhas.append({
                    'usage_date': data,
                    'mes_referencia': data[:7],
                    'workspace_name': wsnome,
                    'workspace_id': wsid,
                    'sku_name': sku,
                    'produto': produto,
                    'usuario': usuario,
                    'endpoint_name': '',
                    'cluster_id': '',
                    'total_dbus': dec(dbus, 4),
                    'preco_unitario_usd': dec(PRECO, 2),
                    'custo_usd': dec(custo, 4),
                    'NOME_BUDGET': budget,
                    'quota_ws_usd': '' if quota is None else dec(quota, 0),
                    'limite_per_user_usd': '' if limite is None else dec(limite, 0),
                    'tipo_limite_per_user': 'mensal',
                })
        resumo.append((wsnome, testa, pct_ws, pct_ua))
    return linhas, resumo


def derivar(linhas):
    """Totais e percentuais saem SEMPRE da soma das linhas."""
    tw = defaultdict(D)
    tu = defaultdict(D)
    for r in linhas:
        c = D(r['custo_usd'])
        tw[(r['workspace_id'], r['mes_referencia'])] += c
        tu[(r['usuario'], r['workspace_id'], r['mes_referencia'])] += c

    for r in linhas:
        cw = tw[(r['workspace_id'], r['mes_referencia'])]
        cu = tu[(r['usuario'], r['workspace_id'], r['mes_referencia'])]
        quota = D(r['quota_ws_usd']) if r['quota_ws_usd'] else None
        limite = D(r['limite_per_user_usd']) if r['limite_per_user_usd'] else None
        pw = (cw / quota * 100) if quota else None
        pu = (cu / limite * 100) if limite else None
        r['custo_usd_total_workspace'] = dec(cw, 4)
        r['custo_usd_total_usuario'] = dec(cu, 4)
        r['pct_quota_ws'] = '' if pw is None else dec(pw, 1)
        r['pct_limite_per_user'] = '' if pu is None else dec(pu, 1)
        r['status_quota_ws'] = status(pw, ST_WS_BLOQ, ST_WS_OK, ST_WS_SEM)
        r['status_per_user'] = status(pu, ST_US_BLOQ, ST_US_OK, ST_US_SEM)


def conferir(linhas, resumo):
    """O alvo declarado tem de bater com o derivado, senao nao grava."""
    erros = []
    for wsnome, _testa, pct_ws, pct_ua in resumo:
        if pct_ws is None:
            continue
        r = next(x for x in linhas if x['workspace_name'] == wsnome)
        if D(r['pct_quota_ws']) != pct_ws:
            erros.append('%s: pct_ws alvo %s, derivado %s'
                         % (wsnome, pct_ws, r['pct_quota_ws']))
        ra = next(x for x in linhas
                  if x['workspace_name'] == wsnome and x['usuario'] == USER_A)
        if D(ra['pct_limite_per_user']) != pct_ua:
            erros.append('%s: pct_user alvo %s, derivado %s'
                         % (wsnome, pct_ua, ra['pct_limite_per_user']))
    if erros:
        raise SystemExit('Cenarios inconsistentes, nada gravado:\n  '
                         + '\n  '.join(erros))


def main():
    linhas, resumo = montar_linhas()
    derivar(linhas)
    conferir(linhas, resumo)

    with io.open(SAIDA, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLUNAS, lineterminator='\r\n')
        w.writeheader()
        w.writerows(linhas)

    print('Gravado: %s  (%d linhas, %d colunas)' % (SAIDA, len(linhas), len(COLUNAS)))
    print('')
    print('%-24s %-42s %8s %8s' % ('workspace', 'testa', 'pct_ws', 'pct_usr'))
    for wsnome, testa, pw, pu in resumo:
        print('%-24s %-42s %8s %8s'
              % (wsnome, testa,
                 pw if pw is not None else '-',
                 pu if pu is not None else '-'))


if __name__ == '__main__':
    main()

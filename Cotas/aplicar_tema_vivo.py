# -*- coding: utf-8 -*-
"""
Aplica o tema Vivo FinOps Manager ao cockpit "Gestão de Cotas".

Le  : cockpit-quotas-v51.html  (intocado)  +  vivo-theme.css
Grava: cockpit-quotas-v51-vivo.html

Por que injetar em vez de editar o HTML a mao: o cockpit tem 1,2 MB, dos quais
~900 KB sao bundles (SheetJS/Chart.js/d3). Editar aquilo a mao e irreversivel e
nao sobrevive a uma v52. Aqui o tema vive em um arquivo proprio e a injecao e
reproduzivel -- quando sair um cockpit novo, basta rodar de novo apontando para
ele.

O que a injecao faz (3 pontos, nada alem disso):
  1. <head>: script de pre-pintura do tema, ANTES de qualquer render, lendo a
     mesma chave localStorage 'finops-theme' do app -- evita o flash de tema
     errado no primeiro paint.
  2. Apos o <style> original: o bloco <style id="vivo-theme"> com o conteudo de
     vivo-theme.css. Vem depois de proposito: mesma especificidade resolve pela
     ordem, entao o tema vence sem precisar de !important.
  3. Dentro da .command-bar: o botao de alternar tema (sol/lua).

NAO altera: marcacao existente, nenhum dos 3 <script>, nenhuma logica. Se o
resultado nao agradar, basta apagar o arquivo de saida -- o original continua la.
"""
import io
import os
import re
import sys

COCKPIT = 'cockpit-quotas-v51.html'
TEMA = 'vivo-theme.css'
SAIDA = 'cockpit-quotas-v51-vivo.html'

MARCA = 'vivo-theme'

# Le o tema salvo pelo app; claro e o padrao, igual a index.html/portal.html.
PRE_PAINT = """<script>/* vivo-theme: pre-pintura, evita flash de tema errado */
(function(){try{var t=localStorage.getItem('finops-theme');
document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');}catch(e){
document.documentElement.setAttribute('data-theme','light');}})();</script>"""

TOGGLE_HTML = """<button class="vv-theme-toggle" id="vvThemeToggle" type="button"
      title="Alternar tema claro/escuro" aria-label="Alternar tema">&#9788;</button>"""

TOGGLE_JS = """<script>/* vivo-theme: alterna e persiste na mesma chave do app */
(function(){var b=document.getElementById('vvThemeToggle');if(!b)return;
var r=document.documentElement;
function sync(){var d=r.getAttribute('data-theme')==='dark';
b.innerHTML=d?'&#9790;':'&#9788;';}
b.addEventListener('click',function(){
var d=r.getAttribute('data-theme')==='dark';
r.setAttribute('data-theme',d?'light':'dark');
try{localStorage.setItem('finops-theme',d?'light':'dark');}catch(e){}
sync();
/* As cores de serie do Chart.js sao lidas no momento em que o grafico e
   criado -- trocar o tema nao as atualiza sozinho. render() e uma function
   declaration do script classico do cockpit, entao esta no escopo global:
   chamada aqui, redesenha os graficos ja com os tokens do tema novo. */
try{if(typeof render==='function')render();}catch(e){}
});sync();})();</script>"""

# Helper lido pelo proprio codigo de grafico do cockpit apos as substituicoes.
# Precisa vir ANTES do script do app na ordem do documento.
CHART_HELPER = """<script>/* vivo-theme: ponte entre os tokens CSS e o Chart.js */
function vvColor(tok, fb){try{var v=getComputedStyle(document.documentElement)
.getPropertyValue(tok).trim();return v||fb;}catch(e){return fb;}}
function vvFont(){return "'IBM Plex Sans','Segoe UI',Arial,sans-serif";}
function vvPalette(){var p=[],i;for(i=1;i<=8;i++){p.push(vvColor('--chart-'+i,'#9333ea'));}
return p;}</script>"""

# (trecho original, ocorrencias esperadas, substituto)
# Casamento por string exata, nunca regex solta -- e o codigo do app; um
# casamento a mais ou a menos aborta a geracao em vez de gravar algo torto.
CHART_SUBS = [
    ("backgroundColor: '#660099'", 1,
     "backgroundColor: vvColor('--chart-consumo','#9333ea')"),
    ("backgroundColor: '#e8d8ef'", 1,
     "backgroundColor: vvColor('--chart-quota-ws','#d6ccf5')"),
    ("backgroundColor: '#f2b8de'", 1,
     "backgroundColor: vvColor('--chart-quota-user','#f6cde4')"),
    ("grid: { color: '#f0eaf4' }", 2,
     "grid: { color: vvColor('--chart-grid','#ede9f6') }"),
    ("ticks: { font: { family: 'Arial' } }", 4,
     "ticks: { color: vvColor('--text-muted','#6b7280'), font: { family: vvFont() } }"),
    ("labels: { font: { family: 'Arial', size: 11", 2,
     "labels: { color: vvColor('--text-muted','#6b7280'), font: { family: vvFont(), size: 11"),
    ("const productPalette = ['#660099', '#e6007e', '#1c9a68', '#d79520', "
     "'#2f6fed', '#8a4fff', '#c93b3b', '#0e9aa7']", 1,
     "const productPalette = vvPalette()"),
]


def main():
    for f in (COCKPIT, TEMA):
        if not os.path.exists(f):
            sys.exit('Arquivo nao encontrado: ' + f)

    html = io.open(COCKPIT, encoding='utf-8').read()
    css = io.open(TEMA, encoding='utf-8').read()

    if MARCA in html:
        sys.exit('O cockpit de entrada ja parece ter o tema aplicado. '
                 'Aponte COCKPIT para o arquivo original.')

    passos = []

    # 1) pre-pintura logo apos <head>
    m = re.search(r'<head[^>]*>', html, re.I)
    if not m:
        sys.exit('<head> nao encontrado.')
    html = html[:m.end()] + '\n' + PRE_PAINT + html[m.end():]
    passos.append('pre-pintura do tema injetada no <head>')

    # 2) bloco de tema apos o </style> do CSS proprio do cockpit.
    #    O cockpit tem outros "<style" dentro dos bundles (SpreadsheetML), por
    #    isso ancoramos no <style> real -- o unico precedido de quebra de linha
    #    e seguido de ':root {' nas primeiras linhas.
    alvo = None
    for m in re.finditer(r'<style>\s*(.{0,80})', html, re.S):
        if ':root' in m.group(1):
            alvo = m
            break
    if alvo is None:
        sys.exit('Bloco <style> proprio do cockpit nao localizado.')
    fim = html.find('</style>', alvo.start())
    if fim == -1:
        sys.exit('</style> correspondente nao encontrado.')
    fim += len('</style>')
    bloco = '\n<style id="%s">\n%s\n</style>\n' % (MARCA, css)
    html = html[:fim] + bloco + html[fim:]
    passos.append('bloco <style id="%s"> injetado apos o CSS original (%d chars)'
                  % (MARCA, len(css)))

    # 3) botao de tema no fim da .command-bar
    m = re.search(r'<nav class="command-bar"[^>]*>', html, re.I)
    if not m:
        sys.exit('.command-bar nao encontrada.')
    fim_nav = html.find('</nav>', m.end())
    if fim_nav == -1:
        sys.exit('</nav> da command-bar nao encontrado.')
    html = html[:fim_nav] + '    ' + TOGGLE_HTML + '\n  ' + html[fim_nav:]
    passos.append('botao de alternancia de tema adicionado a .command-bar')

    # 4) graficos: helper antes do script do app + troca dos literais de cor
    ini_app = html.rfind('<script')
    if ini_app == -1:
        sys.exit('script do app nao localizado.')
    html = html[:ini_app] + CHART_HELPER + '\n' + html[ini_app:]
    passos.append('helper vvColor/vvFont/vvPalette injetado antes do script do app')

    trocas = 0
    for alvo, esperado, novo in CHART_SUBS:
        achou = html.count(alvo)
        if achou != esperado:
            sys.exit('Abortado: esperava %d ocorrencia(s) de %r, encontrei %d. '
                     'O cockpit provavelmente mudou -- revise CHART_SUBS.'
                     % (esperado, alvo[:50], achou))
        html = html.replace(alvo, novo)
        trocas += achou
    passos.append('%d literais de cor dos graficos passaram a ler tokens do tema'
                  % trocas)

    # JS do botao no fim do body
    fim_body = html.rfind('</body>')
    if fim_body == -1:
        sys.exit('</body> nao encontrado.')
    html = html[:fim_body] + TOGGLE_JS + '\n' + html[fim_body:]
    passos.append('handler do botao adicionado antes de </body>')

    io.open(SAIDA, 'w', encoding='utf-8', newline='').write(html)

    print('Gravado: %s' % SAIDA)
    print('Entrada: %s (intocado)' % COCKPIT)
    print('')
    for i, p in enumerate(passos, 1):
        print('  %d. %s' % (i, p))


if __name__ == '__main__':
    main()

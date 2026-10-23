# 15-TESTING — Suíte, instabilidades conhecidas e técnicas

Os comandos do dia a dia ficam em `CLAUDE.md`. Aqui fica o que só importa quando algo
estranho acontece, ou quando é preciso testar algo que a suíte normal não alcança.

## Instabilidade do pool do Vitest, e como contornar

A suíte leva ~4 min e às vezes cospe `[vitest-pool]: Timeout waiting for worker to respond` em
alguns arquivos — é o pool de forks estourando no Windows, não teste quebrado; o exit code segue 0
e a contagem de arquivos fecha. Só investigue se algum arquivo aparecer como `failed`.

Quando o pool flaka a ponto de a CONTAGEM variar entre execuções (já aconteceu: 54 arquivos numa
rodada, 39 com 15 erros na seguinte), não adianta reler a saída — peça relatório estruturado, que
não depende do stdout:

```bash
cd frontend && npx vitest run --reporter=json --outputFile=<caminho>.json --pool=threads --maxWorkers=2
```

Confirmar comportamento de função embutida em `server.js` sem subir o servidor: extrair o trecho
por linha e executá-lo com `new Function(...deps)`, injetando dependências stubadas. Foi assim que
se provou que 157 anomalias viram 1 e-mail e que o resumo de economia trata os dois portais com
bases diferentes. **Vale o esforço**: `node --check` passa em código sintaticamente válido e
semanticamente errado — um bloco de resumo acabou DENTRO do laço que deveria agregar, e só o teste
pegou.

Servidor de desenvolvimento: se uma mudança não refletir, confira se o processo na porta 3000 não
é um node órfão (nodemon morre e deixa o filho rodando, servindo código antigo indefinidamente).
`Get-NetTCPConnection -LocalPort 3000 -State Listen` mostra o PID e a hora de início.

---

See **08-FRONTEND-REACT.md** for component conventions; **02-ARCHITECTURE.md** for why `server.js` needs the extraction technique.

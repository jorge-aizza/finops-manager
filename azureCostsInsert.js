'use strict';
// Inserção de linhas de custo em LOTE, com queda para linha-a-linha quando o lote falha.
//
// Por que existe: a importação gravava uma linha por comando, com SAVEPOINT e RELEASE em volta —
// três idas ao banco por linha. Medido em 2026-11-10 na recoleta de outubro: 1.787.962 linhas em
// 2h49, ou ~176 linhas/s. Nesse ritmo um mês da base inteira passa de 20 horas.
//
// O SAVEPOINT por linha existe por um motivo real: uma linha ruim (encoding, número fora de
// faixa) não pode derrubar o lote inteiro. Por isso aqui não se troca uma coisa pela outra —
// tenta o lote, e SÓ se ele falhar volta ao modo linha-a-linha para aquele lote. O caminho feliz
// fica rápido; o caminho ruim continua tolerante e identifica a linha problemática como antes.

// Limite de parâmetros de um comando no protocolo do Postgres.
const MAX_PARAMS_PG = 65535;

// Quantas linhas cabem num comando, dado o número de colunas. Sem isto, um lote grande demais
// falha com "bind message has N parameter formats but M parameters" e cairia no fallback sempre,
// ficando MAIS lento que o original.
function linhasPorComando(numColunas, tetoDesejado) {
  const cabe = Math.floor(MAX_PARAMS_PG / Math.max(1, numColunas));
  return Math.max(1, Math.min(cabe, tetoDesejado || cabe));
}

// INSERT com N tuplas de placeholders: ($1,$2,...), ($k+1,...), ...
function montarInsertMultiplo(tabela, colunas, numLinhas) {
  const nCols = colunas.length;
  const tuplas = new Array(numLinhas);
  for (let i = 0; i < numLinhas; i++) {
    const ph = new Array(nCols);
    for (let c = 0; c < nCols; c++) ph[c] = '$' + (i * nCols + c + 1);
    tuplas[i] = '(' + ph.join(', ') + ')';
  }
  return `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${tuplas.join(', ')}`;
}

function achatarValores(colunas, linhas) {
  const valores = [];
  for (const linha of linhas) {
    for (const col of colunas) valores.push(linha[col] ?? null);
  }
  return valores;
}

// Insere `linhas` (objetos já mapeados) usando `client`, que precisa estar numa transação.
//
// Devolve { ins, err }. `onErroLinha(erro, linha, indice)` é chamado para cada linha recusada no
// fallback — é por onde o chamador mantém a amostra de erros que já exibe hoje.
//
// Pressupõe que a tabela NÃO tem constraint única (o índice de dedup foi removido em 2026-11-10,
// ver MODULES/04-AZURE-API.md): sem ela, um INSERT múltiplo não pode falhar por conflito, só por
// linha malformada — que é exatamente o caso que o fallback trata.
async function inserirLinhasEmLote(client, tabela, colunas, linhas, opts = {}) {
  const { onErroLinha = null, tetoLinhasPorComando = 500 } = opts;
  let ins = 0;
  let err = 0;
  if (!linhas.length) return { ins, err };

  const porComando = linhasPorComando(colunas.length, tetoLinhasPorComando);

  for (let i = 0; i < linhas.length; i += porComando) {
    const fatia = linhas.slice(i, i + porComando);

    // Caminho rápido. O SAVEPOINT em volta é o que permite desfazer SÓ esta tentativa: sem ele,
    // um erro aborta a transação inteira e o fallback não teria onde rodar.
    await client.query('SAVEPOINT lote');
    try {
      await client.query(montarInsertMultiplo(tabela, colunas, fatia.length), achatarValores(colunas, fatia));
      await client.query('RELEASE SAVEPOINT lote');
      ins += fatia.length;
      continue;
    } catch (_) {
      await client.query('ROLLBACK TO SAVEPOINT lote');
      await client.query('RELEASE SAVEPOINT lote');
    }

    // Caminho tolerante: isola a linha ruim sem perder as boas da mesma fatia.
    const sqlUnica = montarInsertMultiplo(tabela, colunas, 1);
    for (let j = 0; j < fatia.length; j++) {
      await client.query('SAVEPOINT linha');
      try {
        await client.query(sqlUnica, achatarValores(colunas, [fatia[j]]));
        await client.query('RELEASE SAVEPOINT linha');
        ins++;
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT linha');
        await client.query('RELEASE SAVEPOINT linha');
        err++;
        if (onErroLinha) onErroLinha(e, fatia[j], i + j);
      }
    }
  }

  return { ins, err };
}

module.exports = {
  MAX_PARAMS_PG,
  linhasPorComando,
  montarInsertMultiplo,
  achatarValores,
  inserirLinhasEmLote,
};

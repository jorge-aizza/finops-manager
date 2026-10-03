# Guia de Configuração — Conectando o Databricks ao FinOps Manager

> Guia passo a passo para quem vai configurar a conexão, sem necessidade de conhecimento
> técnico prévio em APIs ou programação. Revisado em 2026-10-03 direto contra as telas
> atuais do sistema — todos os nomes de botão/campo abaixo batem com o que você vai ver.

## O que você precisa ter em mãos antes de começar

- Acesso a um workspace do Databricks (a URL dele, algo como
  `https://adb-1234567890123456.7.azuredatabricks.net`).
- Um **SQL Warehouse** já criado nesse workspace (se não existir nenhum, peça pro time de
  dados criar um — é rápido).
- Acesso de **administrador no FinOps Manager** (pra cadastrar a configuração).
- Escolher uma das duas formas de conectar abaixo — **Opção A é mais simples e rápida**,
  recomendada pra começar. A Opção B é mais robusta pra produção, mas exige um acesso
  especial no Databricks (Account Admin).

---

## Opção A — Personal Access Token (recomendado para começar)

Não exige nenhum acesso administrativo especial no Databricks — qualquer usuário com acesso
ao workspace consegue gerar o seu.

1. Entre no workspace do Databricks normalmente, pelo navegador.
2. Clique no seu usuário, no canto superior direito da tela.
3. Clique em **"User Settings"**.
4. Vá na aba **"Developer"** → **"Access tokens"** → botão **"Generate new token"**.
5. Dê um nome pro token (ex.: `FinOps Manager`), escolha uma validade (se seu time de
   segurança não exigir um prazo específico, pode deixar o padrão) e clique em **"Generate"**.
6. **Copie o token exibido na tela imediatamente.** Ele começa com `dapi...` e só aparece
   essa vez — se fechar a tela sem copiar, precisa gerar outro.
7. Abra o FinOps Manager, vá no menu lateral em **"Coleta Azure"**.
8. Role a página até o card **"Coleta Databricks"** e clique em **"Nova Configuração"**.
9. Preencha o formulário:
   - **Nome**: um nome pra identificar essa conexão (ex.: `Databricks Produção`)
   - **Modo de autenticação**: selecione **"Personal Access Token"**
   - **Personal Access Token**: cole o token que você copiou no passo 6
   - **Workspace Host**: veja como pegar na seção [Onde encontrar os dados do workspace](#onde-encontrar-os-dados-do-workspace) abaixo
   - **SQL Warehouse ID**: idem, veja a seção abaixo
10. Clique em **"Salvar"**.
11. Na linha que aparece na tabela, clique no ícone **🔌 (Testar conexão)**.

Se aparecer a mensagem **"Conexão com Databricks OK"**, está pronto — pule para a seção
[Depois de conectar](#depois-de-conectar). Se der erro, veja [Resolvendo problemas](#resolvendo-problemas-erro-401) mais abaixo.

---

## Opção B — OAuth M2M com Service Principal (mais robusta, para produção)

Essa opção não depende de um usuário específico (o acesso não é cancelado se a pessoa sair
da empresa), mas tem mais passos e exige acesso de **Account Admin** no Databricks.

### Passo 1 — Criar o Service Principal na conta Databricks

1. Acesse `https://accounts.azuredatabricks.net` com uma conta de Account Admin.
2. Vá em **"User management"** → aba **"Service principals"** → **"Add service principal"**.
3. Dê um nome (ex.: `finops-manager-sp`) e salve.
4. Na tela do Service Principal recém-criado, anote o **"Application ID"** — esse valor vai
   no campo **Client ID** do FinOps Manager.

### Passo 2 — Gerar o segredo (Client Secret)

1. Ainda na tela do Service Principal, procure a aba **"Secrets"** (ou **"OAuth secrets"**).
2. Clique em **"Generate secret"**.
3. **Copie o segredo exibido imediatamente** — assim como o token, ele só aparece uma vez.
   Esse valor vai no campo **Client Secret**.

### Passo 3 — Anotar o Account ID

1. No console da conta (`accounts.azuredatabricks.net`), clique no seu usuário no canto
   superior direito.
2. O **"Account ID"** aparece ali — é um código longo (formato UUID, tipo
   `12345678-abcd-1234-abcd-123456789012`). Copie-o.

### Passo 4 — ⚠️ Adicionar o Service Principal ao workspace (passo que mais gera erro de acesso negado)

Um Service Principal criado na conta **não tem acesso automático a nenhum workspace** — esse
é o passo que mais causa erro de autenticação quando é esquecido.

1. Entre no workspace Databricks específico que você vai conectar ao FinOps Manager.
2. Clique no ícone de engrenagem (**"Admin Settings"**).
3. Vá em **"Identity and access"** → **"Service principals"** → **"Add service principal"**.
4. Procure o Service Principal criado no Passo 1 (pelo nome ou pelo Application ID) e
   adicione-o a este workspace.

### Passo 5 — Dar permissão no SQL Warehouse

1. No workspace, vá em **"SQL Warehouses"** (menu lateral).
2. Clique no warehouse que você vai usar.
3. Vá na aba **"Permissions"**.
4. Adicione o Service Principal com o nível **"Can Use"**.

### Passo 6 — Liberar acesso às tabelas de consumo (System Tables)

1. Como Account Admin, vá em **"Catalog Explorer"** → catálogo **"system"** → **"Permissions"**.
2. Garanta que o Service Principal (ou um grupo ao qual ele pertença) tenha `USE CATALOG`
   e `SELECT` nesse catálogo.
3. Se o catálogo **"system"** nem aparecer na lista, um Account Admin precisa habilitá-lo
   primeiro — no Account Console, em **Workspace → Catalogs → "system" schemas**, habilite
   pelo menos o schema **`billing`** (obrigatório — sem ele, nenhum custo é coletado). Os
   schemas `lakeflow`, `compute`, `query`, `ai_gateway` e `storage` são opcionais — sem eles
   o sistema funciona normalmente, só alguns cards extras do Dashboard ficam vazios.

### Passo 7 — Cadastrar no FinOps Manager

1. Menu lateral → **"Coleta Azure"** → card **"Coleta Databricks"** → **"Nova Configuração"**.
2. Preencha:
   - **Nome**: um nome pra identificar essa conexão
   - **Modo de autenticação**: **"OAuth M2M (Service Principal da conta)"**
   - **Account ID**: valor do Passo 3
   - **Client ID**: valor do Passo 1 (Application ID)
   - **Client Secret**: valor do Passo 2
   - **Workspace Host** e **SQL Warehouse ID**: veja a seção abaixo
3. Clique em **"Salvar"**, depois no ícone **🔌 (Testar conexão)** na linha criada.

---

## Onde encontrar os dados do workspace

- **Workspace Host**: é o endereço que aparece na barra do navegador quando você está
  dentro do workspace Databricks — algo como `https://adb-1234567890123456.7.azuredatabricks.net`.
  Copie só até o `.net`, sem nada depois disso (sem `/` no final, sem caminho de página).

- **SQL Warehouse ID**: vá em **"SQL Warehouses"** → clique no warehouse desejado → aba
  **"Connection details"**. Lá tem um campo **"HTTP Path"**, parecido com
  `/sql/1.0/warehouses/abc123def456789`. O **SQL Warehouse ID** é só a parte final, depois
  de `/warehouses/` — nesse exemplo, `abc123def456789`.

---

## Resolvendo problemas (erro 401)

Depois de salvar a configuração, sempre teste clicando no ícone **🔌 (Testar conexão)**. Se
aparecer um erro de autenticação (código 401), siga esta ordem de verificação:

1. **Usando OAuth M2M (Opção B)?** Confira, nesta ordem:
   - Passo 4 foi feito? (Service Principal adicionado AO WORKSPACE, não só à conta) — esta
     é a causa mais comum, de longe.
   - Passo 5 foi feito? (permissão "Can Use" no SQL Warehouse)
   - Passo 6 foi feito? (permissão `SELECT` no catálogo `system`)
   - O **Account ID** foi colado certinho, sem espaço em branco no início ou no fim?
2. **Usando Personal Access Token (Opção A)?**
   - O token pode ter expirado (se foi gerado com validade) ou ter sido revogado — gere um
     novo (Passo 5 da Opção A) e atualize a configuração no FinOps Manager (edite a
     configuração e cole o novo token).
3. Se mesmo depois de conferir tudo isso o erro continuar, copie **a mensagem de erro
   completa** mostrada na tela (não só "401" — o aviso costuma vir com um texto maior,
   explicando o motivo exato) e encaminhe pro time técnico. Esse texto completo é o que
   permite identificar a causa específica sem adivinhar.

**Se a conexão em si funcionar, mas alguma "tabela" aparecer com ❌ no resultado do teste:**
é esperado se for uma das tabelas opcionais (ligadas a Job runtime, utilização de cluster,
custo por query, AI Gateway ou otimização de storage) — isso só deixa vazio o card
correspondente no Dashboard, o resto continua funcionando normalmente. Se for uma das duas
tabelas de billing (consumo ou lista de preços), repita o Passo 6 — sem elas, nenhum dado de
custo é coletado.

---

## Depois de conectar

- Clique no ícone **⏰ (Agendamento)**, na linha da configuração, pra definir de quanto em
  quanto tempo a coleta deve rodar automaticamente (ou colete manualmente quando quiser).
- Clique em **"Ver Dashboard"** pra acompanhar consumo, custo por workspace/usuário e
  orçamentos — os dados aparecem depois da primeira coleta ser concluída.

---

*Referência técnica para quem for mexer no código (endpoints, formato das chamadas,
mensagens de erro internas): `MODULES/05-DATABRICKS-API.md`.*

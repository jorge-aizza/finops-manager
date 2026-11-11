# 18 — Tela de autenticação

Este módulo documenta a estrutura visual e os estados da página de login do FinOps Manager.
Ele complementa `03-AUTHENTICATION.md`, que descreve validação de credenciais, tokens,
perfis e autorização no backend.

## Arquivos responsáveis

| Arquivo | Responsabilidade |
|---|---|
| `index.html` | Estrutura da tela, estilos específicos de login e bootstrap inicial de sessão/tema |
| `app.js` | Carregamento de recursos, submissão do login, SSO, erros e transição para o app |
| `styles.css` | Tokens globais, tema claro/escuro, tipografia e componentes compartilhados |
| `server.js` | Endpoints de autenticação e callbacks; não duplicar aqui as regras completas do módulo 03 |

## Estrutura visual

A tela fica no elemento `#login-screen`, que cobre a viewport. O cartão `.login-box` tem largura
máxima de 400 px e contém, nesta ordem:

1. Logo FinOps e nome do produto.
2. Texto de instrução para entrar.
3. Mensagem de erro ou informação, quando necessário.
4. Campos de e-mail e senha e botão **Entrar**.
5. Divisor e botões para Microsoft Entra ID e Active Directory.
6. Rodapé com nome e versão do sistema.

No tema escuro, o fundo usa `/react-app/images/Finops_home.png`, com uma camada de contraste e
cartão translúcido. No tema claro, o CSS define um fundo cinza claro e cartão branco. Preserve
as duas variantes e verifique ambas após alterar seletores: as regras específicas de `#login-screen`
têm especificidade maior que regras genéricas do tema.

## Carregamento com a marca FinOps

`#login-page-loading` é um overlay de tela cheia, exibido desde o início da página. Ele usa a
composição visual compartilhada com o loader pós-login: logo FinOps, spinner e uma mensagem de
status. As duas variantes do logo (`topbar-logo-light` e `topbar-logo-dark`) permitem manter a
marca legível de acordo com o tema.

`waitForLoginAssets()` em `app.js` espera a decodificação dos logos e da imagem de fundo antes
de ocultar o overlay. Se o carregamento ultrapassar 8 segundos, aplica `login-background-fallback`
e libera a tela de login com um fundo sólido. Uma falha de imagem não deve manter o loader
preso. O teste visual deve confirmar tanto o logo quanto o texto/spinner do loader.

O overlay usa `role="status"`, `aria-live="polite"` e `aria-atomic="true"`. Ao ser removido,
recebe `aria-hidden="true"`.

## Restauração de sessão

Um script inicial em `index.html` identifica uma sessão candidata e marca
`data-session-restoring="true"` no elemento `<html>`. Nesse estado, a tela de login fica oculta
e `.session-restore-screen` informa que a sessão está sendo restaurada. `app.js` valida a sessão:
se for válida, chama `enterApp()`; se não, finaliza o carregamento e apresenta o login.

O loader inicial é distinto do `#app-startup-loading`, que cobre a transição para o app até a
view React emitir `finops:app-view-mounted` ou até o timeout de segurança.

## Envio do formulário

Ao enviar e-mail e senha, `setLoginPending()` desabilita o botão, marca `aria-busy="true"` e
mostra o spinner do botão. Ao terminar a requisição, o estado pendente é removido. Erros e
informações são exibidos em `#login-error` por `showLoginError()` e `showLoginInfo()`.

## Ações de autenticação apresentadas

| Ação | Comportamento na interface | Observação |
|---|---|---|
| Entrar | Chama `POST /api/auth/login` com e-mail e senha | O endpoint valida contas locais; ver módulo 03 |
| Microsoft Entra ID | Busca `GET /api/auth/entra/url` e redireciona o navegador à URL retornada | O callback e a validação de token estão descritos no módulo 03 |
| Active Directory | Chama `loginSSO('ad')`, que atualmente mostra uma mensagem informativa | O botão não chama `/api/auth/ad`; não o descreva como autenticação AD integrada até que o fluxo da tela seja implementado |

A existência de um botão não garante que o respectivo método de autenticação esteja conectado.
Atualize esta tabela se os fluxos da tela ou os endpoints mudarem.

## Tema, logo e movimento

- O tema é controlado por `data-theme="light"` no `<html>` e pela preferência `finops-theme` em `localStorage`; o mecanismo geral está em `17-TEMA-E-VISUAL.md`.
- Use os tokens globais para cores sempre que possível. Os estilos específicos do login ainda contêm valores de marca e transparência; ao alterá-los, revise contraste nos dois temas.
- Não aplique filtros CSS diretamente ao logo para corrigir contraste. Use a variante de asset apropriada para o tema e mantenha a proporção.
- Respeite `prefers-reduced-motion`: efeitos de logo/fundo e o spinner devem reduzir ou remover animação quando solicitado pelo sistema operacional.
- O cartão deve continuar centrado e caber em viewports estreitas; confira especialmente 640 px e 380 px de largura.

## Checklist de alteração

- [ ] O loader FinOps cobre a tela desde o primeiro render e exibe logo, spinner e mensagem.
- [ ] Com cache frio, a tela aparece depois dos logos e do fundo ou usa o fallback após o limite.
- [ ] Com a imagem ausente ou lenta, o login continua acessível e o loader não fica preso.
- [ ] A restauração de sessão válida pula o formulário e abre o app.
- [ ] Os erros, o estado pendente e o botão Entra continuam legíveis e operáveis.
- [ ] Tema claro e escuro, foco por teclado, contraste e movimento reduzido foram verificados.
- [ ] O fluxo AD descrito na tela corresponde ao comportamento real do botão.

## Limites

Este documento trata da página e da experiência de entrada. Regras de credenciais, grupos,
perfis, validade e revogação de tokens pertencem a `03-AUTHENTICATION.md`. A orientação geral
sobre tokens visuais e layout está em `17-TEMA-E-VISUAL.md`.

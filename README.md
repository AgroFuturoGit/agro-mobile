# ProduPlan Campo (agro-mobile)

App mobile **offline-first** do ProduPlan, feito com Expo + React Native +
TypeScript. Consome a API [`agro-backend`](../agro-backend) (Spring Boot) e
reaproveita os contratos já validados no [`agro-frontend`](../agro-frontend).

O alvo é o trabalho em campo: o agricultor registra a colheita onde não há
sinal, e o aparelho sincroniza sozinho quando a conexão volta.

## Escopo: o que é deste app e o que é do web

O app **não** busca paridade de funcionalidades com o `agro-frontend`. A
divisão é deliberada:

|                                                                                             | Onde fica             | Por quê                                                                         |
| :------------------------------------------------------------------------------------------ | :-------------------- | :------------------------------------------------------------------------------ |
| **Configuração e cadastro** — organizações, comunidades, usuários, perfis, culturas, safras | `agro-frontend` (web) | Baixa frequência, exige validação cruzada entre entidades e é feito com conexão |
| **Operação de campo** — planos de produção, apontamento de colheita, previsto × realizado   | Este app              | É o que acontece sem sinal, longe do escritório                                 |

O motivo é técnico, não só de produto: a escrita offline vira item de fila, e
uma entidade criada offline recebe id provisório. Enquanto ela não sincroniza,
nada pode referenciá-la — a própria tela de plano já convive com isso
(`canReceiveExecutions`). Cadastro é justamente o que mais gera referências
entre entidades, então enfileirá-lo multiplicaria esse problema por seis.

Culturas e safras aparecem no app **somente leitura**, em cache: são
necessárias para montar um plano, mas quem as edita é o web.

## Como rodar no Expo Go

```bash
npm install
npm start
```

Leia o QR code com o app **Expo Go** (Android/iOS). O celular precisa estar na
mesma rede Wi-Fi do notebook.

Suba o backend antes:

```bash
cd ../agro-backend && docker compose up -d   # API em :8080
```

### Como o app acha a API

Ordem de precedência:

1. `EXPO_PUBLIC_API_URL` (crie um `.env` a partir do `.env.example`);
2. **IP da máquina do Metro + porta 8080** — detectado automaticamente pelo
   `hostUri` do Expo, é o que faz funcionar no Expo Go sem configuração;
3. `http://localhost:8080` (emulador/web).

Dá para trocar em tempo de execução na aba **Perfil → Servidor**, útil para
apontar para outro backend sem reiniciar o bundler.

> `localhost` **não** funciona num celular físico: lá o `localhost` é o próprio
> aparelho. Por isso a detecção do item 2 existe.

**Num APK standalone o item 2 não existe**: o `hostUri` é uma informação do
Metro, e num app instalado não há Metro. Por isso o build precisa de
`EXPO_PUBLIC_API_URL` — e a tela de login tem um campo de servidor, para o
endereço ser corrigido no aparelho sem gerar outro APK.

### Usuário de teste

O `DataInitializer` do backend cria `admin@admin.com` / `12345678` (perfil
ADMIN).

## Scripts

| Script                            | O que faz                                   |
| :-------------------------------- | :------------------------------------------ |
| `npm start`                       | Metro + QR code do Expo Go                  |
| `npm run android` / `ios` / `web` | Abre direto na plataforma                   |
| `npm run lint` / `lint:fix`       | ESLint (config Expo + ordenação de imports) |
| `npm run typecheck`               | `tsc --noEmit`                              |
| `npm test` / `test:watch`         | Jest (preset `jest-expo`)                   |
| `npm run format`                  | Prettier                                    |

Os três primeiros rodam no CI a cada push e pull request
(`.github/workflows/ci.yml`).

## O que já está implementado

### Autenticação

- `POST /auth/login` → token JWT no **SecureStore** (keychain/keystore) e
  usuário no AsyncStorage;
- sessão restaurada no boot: quem já entrou uma vez abre o app offline;
- expiração lida do próprio JWT (`exp`, 4 h no backend). Sessão vencida **não**
  expulsa o usuário: o app segue utilizável com os dados locais, a fila
  continua aceitando registros e um banner oferece novo login;
- revalidação contra `GET /auth/me` ao abrir o app e ao recuperar sinal: papel
  alterado pelo administrador passa a valer sem exigir novo login. Falha de
  rede não muda nada, e só um 401 explícito derruba a sessão;
- controle de escrita por papel — MANAGER é somente leitura, conforme os
  `@PreAuthorize` do `ProductionController`;
- endereço do servidor editável **na própria tela de login**, não só no Perfil:
  num APK instalado o Perfil fica atrás do login, então sem isso um endereço
  errado deixaria o usuário sem saída.

### Planos de produção e apontamentos

O fluxo mais maduro do front web, portado por inteiro:

- lista de planos do agricultor (`GET /farmers/{id}/production-plans`);
- detalhe do plano com **previsto x realizado** e barra de progresso;
- CRUD de apontamentos de colheita (`/production-plans/{id}/executions`);
- CRUD de planos, com culturas e safras vindas de `/crops` e `/harvests`;
- resolução do agricultor por papel (`farmerDiscoveryFor`, em
  `src/domain/farmers.ts`):
  - **FARMER** → `GET /farmers/me`, cai direto nos próprios planos;
  - **ADMIN/MANAGER** → seleção de agricultor via `GET /farmers`;
  - **TECHNICIAN** → seleção restrita aos agricultores atribuídos a ele, via
    `GET /technicians/me/farmers`.

## Como o offline funciona

Três peças, em `src/lib`:

**`cache.ts` + `use-cached-query.ts`** — toda leitura é _cache-first_: mostra o
que está no aparelho e revalida em seguida. Sem rede, o cache é a resposta, não
um erro. O rodapé de cada tela informa a idade do dado.

**`outbox.ts`** — toda escrita feita sem conexão vira um item de fila
persistido. A fila é agrupada **por recurso**: dentro de um plano as operações
sobem em ordem de criação (um `update` depende do `create` anterior, um
apontamento depende do plano que o hospeda); entre planos diferentes elas são
independentes.

Esse agrupamento é o que impede um problema num plano de travar o resto: como
a fila era um único lote serial, um 5xx no primeiro item bloqueava todos os
apontamentos do dia, inclusive de planos sem relação com a falha.

O tratamento de erro segue essa fronteira:

| Erro                   | Efeito                                                                                                                         |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| Sem rede               | Interrompe o lote inteiro — não há o que tentar em nenhum recurso                                                              |
| 401 / 403              | Interrompe o lote inteiro; o item continua _pendente_, porque o problema é a credencial, não o dado                            |
| 5xx ou erro inesperado | Bloqueia **só aquele recurso**, com espera exponencial (30 s → 30 min). Após 5 tentativas o item passa a exigir reenvio manual |
| 409                    | Alteração concorrente: alguém editou o mesmo registro antes. Ver abaixo                                                        |
| 4xx                    | O item é inválido (plano apagado, dado recusado): marca como _recusado_ e pula o resto daquele recurso, que dependia dele      |

### Conflito: quando duas pessoas editam o mesmo registro

Um 409 não é um erro do dado — é uma corrida perdida. Por isso ele tem estado
próprio na fila (`conflict`, ao lado de `pending` e `failed`) e tratamento
diferente de um 4xx comum: **o resto do recurso continua sendo despachado**,
porque o plano existe e está mais novo, então um apontamento na fila
provavelmente ainda se aplica.

A versão do servidor vem no corpo do 409 (campo `current`) e substitui o dado
local; a tela de Sincronização mostra o item com o selo **"Conflito"** e
explica que a versão de quem editou antes já está em tela. Reenviar não é
oferecido: o item carrega a versão antiga e seria recusado de novo — o caminho
é descartar e refazer, se ainda fizer sentido.

Para o servidor conseguir detectar a corrida, a edição envia em
`baseUpdatedAt` a **versão que o usuário tinha em mãos ao abrir o formulário**,
guardada no item da fila. Não serve o instante da edição: um registro feito
offline chega ao servidor sempre com carimbo mais recente que o do banco, então
venceria toda disputa e o conflito nunca apareceria.

Quando um plano criado offline é finalmente aceito, a API devolve o id real e
a fila **reescreve** o id provisório em tudo que ainda aponta para ele —
caminho da requisição, `meta`, chaves de cache e snapshot. Sem isso a operação
seguinte do mesmo plano bateria num 404 e o registro feito em campo se perderia
sem aviso.

**`mutate.ts`** — decide entre enviar agora ou enfileirar. Erro de validação da
API sobe para a tela; só ausência de resposta vira item de fila.

O que está na fila aparece nas listas com o selo **"A enviar"**
(`overlayPlans`/`overlayExecutions`), e o comparativo previsto x realizado é
recalculado no aparelho para já incluir esses registros. A aba
**Sincronização** mostra a fila, permite reenviar, descartar e forçar o envio;
o disparo automático acontece quando a conexão volta.

### Fronteiras conscientes

- **Primeiro login exige internet.** Não guardamos hash de senha local; sem
  nunca ter autenticado, não há sessão para restaurar.
- **Plano criado offline não aceita apontamento** até sincronizar: o id ainda
  é local (`local-…`) e a API precisa de um id real para vincular a execução.
  A tela avisa e o botão fica indisponível.
- **Sair da conta preserva a fila** (apaga só cache e sessão). Apontamento
  feito no campo não se perde por causa de um logout.

## Estrutura

```
src/
├── config/env.ts        resolução da URL da API (inclui detecção do IP no Expo Go)
├── domain/              contratos da API: auth, farmers, production, catalog
├── lib/                 api, cache, outbox, mutate, net, secure, storage, format
├── hooks/               use-cached-query (cache-first + revalidação)
├── contexts/            AuthContext (sessão), SyncContext (rede + fila)
├── navigation/          stack raiz, abas e pilha de planos
├── screens/             login, agricultores, planos, detalhe, formulários, sync, perfil
├── components/          banner de estado, estados vazios/erro/carregando
└── theme/               tema Paper alinhado ao emerald do front web
```

Os testes ficam ao lado do código que exercitam (`*.test.ts`) e cobrem o que
decide o que sobe para a API: fila (`lib/outbox`), sobreposição da fila e
comparativo (`domain/production`), leitura do JWT (`domain/auth`) e
formatação/parsing de número e data (`lib/format`).

## Convenções

- **TypeScript estrito**, com `noUncheckedIndexedAccess`.
- **Named exports** em todo o código de aplicação.
- **Imports ordenados** pelo `eslint-plugin-simple-import-sort`: react/RN →
  externos → alias `@/` → relativos.
- **Alias `@/`** para `src/` (tsconfig paths, resolvido também pelo Metro).
- **Validação com Zod** nas entradas de formulário.
- **Prettier** + `eslint-config-prettier` para não conflitar com o ESLint.

## Gerando o APK

O app roda no Expo Go em desenvolvimento, mas o trabalho de campo exige um APK
instalado. Nenhuma dependência do projeto pede código nativo customizado, então
o build sai pelo fluxo padrão do Expo (CNG): a pasta `android/` é **gerada** e
descartável, e por isso está no `.gitignore`.

### Antes de buildar: as duas configurações que o APK exige

Fora do Expo Go, duas coisas mudam de comportamento e já estão tratadas:

1. **Endereço da API.** Sem Metro não há `hostUri`, então a detecção
   automática cairia em `localhost`. Passe `EXPO_PUBLIC_API_URL` no build
   (`.env` local ou o campo `env` do perfil no `eas.json`). Se o endereço
   mudar depois, a tela de login tem um campo de servidor — não precisa de
   APK novo.
2. **HTTP puro.** O backend roda em `http://IP:8080` e o Android bloqueia
   cleartext em release desde a API 28. O `app.json` já declara
   `expo-build-properties` com `usesCleartextTraffic: true`. Num backend com
   HTTPS essa permissão pode sair.

### Build local

Precisa de JDK, Android SDK Platform 36 e build-tools instalados, com
`ANDROID_HOME` exportado. A documentação do Expo pede **JDK 17**; versões mais
novas costumam funcionar, mas é o primeiro suspeito quando o Gradle falha.

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080 npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

O APK sai em `android/app/build/outputs/apk/release/`. Sem keystore
configurada, `assembleRelease` gera um APK assinado com chave de debug: serve
para instalar e testar, não para distribuir. Para uma chave própria, veja a
documentação do Expo sobre assinatura local.

Atalho para instalar direto num aparelho conectado por USB:

```bash
npx expo run:android --variant release
```

### Build na nuvem (EAS)

Exige conta Expo (`eas login`). Os perfis estão no `eas.json`, todos gerando
APK — não AAB, porque o app não vai para a Play Store:

| Perfil        | Para quê                               |
| :------------ | :------------------------------------- |
| `development` | Development build, com dev client      |
| `preview`     | APK de teste para distribuição interna |
| `production`  | APK final                              |

```bash
eas build --platform android --profile preview
```

Preencha `EXPO_PUBLIC_API_URL` no perfil antes de rodar — no `eas.json` a chave
existe vazia justamente para ser preenchida.

## Limitações conhecidas (backend)

Coisas que ainda travam funcionalidade aqui e valem uma correção no
`agro-backend`:

1. **Token expirado responde 500, não 401.** `JwtAuthenticationFilter` deixa a
   `RuntimeException` de `getSubjectFromToken` escapar. O app contorna lendo o
   `exp` localmente e tratando 500 como "não sei", nunca como "sessão
   inválida" — mas o correto seria o filtro devolver 401.
2. **Sem refresh token.** Com 4 h de validade, uma jornada de campo inteira
   exige novo login para sincronizar.
3. **`GET /farmers` não respeita a organização do gerente.**
   `FindAllFarmersUseCase.findAll(communityId)` ignora o usuário logado, então
   qualquer MANAGER recebe todos os agricultores do sistema. O web contorna pela
   navegação (pousa o gerente na organização certa via `/managers/me`); o app
   exibe o que a API devolve. É falha de autorização, não de interface.

> A limitação anterior de que o perfil TECHNICIAN não conseguia listar
> agricultores **não existe mais**: `GET /technicians/me/farmers` está
> implementado no backend e o app passou a usá-lo.

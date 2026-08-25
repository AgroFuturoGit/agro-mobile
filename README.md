# ProduPlan Campo (agro-mobile)

App mobile **offline-first** do ProduPlan, feito com Expo + React Native +
TypeScript. Consome a API [`agro-backend`](../agro-backend) (Spring Boot) e
reaproveita os contratos já validados no [`agro-frontend`](../agro-frontend).

O alvo é o trabalho em campo: o produtor registra a colheita onde não há
sinal, e o aparelho sincroniza sozinho quando a conexão volta.

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

### Usuário de teste

O `DataInitializer` do backend cria `admin@admin.com` / `12345678` (perfil
ADMIN).

## Scripts

| Script | O que faz |
| :--- | :--- |
| `npm start` | Metro + QR code do Expo Go |
| `npm run android` / `ios` / `web` | Abre direto na plataforma |
| `npm run lint` / `lint:fix` | ESLint (config Expo + ordenação de imports) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier |

## O que já está implementado

### Autenticação

- `POST /auth/login` → token JWT no **SecureStore** (keychain/keystore) e
  usuário no AsyncStorage;
- sessão restaurada no boot: quem já entrou uma vez abre o app offline;
- expiração lida do próprio JWT (`exp`, 4 h no backend). Sessão vencida **não**
  expulsa o usuário: o app segue utilizável com os dados locais, a fila
  continua aceitando registros e um banner oferece novo login;
- controle de escrita por papel — MANAGER é somente leitura, conforme os
  `@PreAuthorize` do `ProductionController`.

### Planos de produção e apontamentos

O fluxo mais maduro do front web, portado por inteiro:

- lista de planos do produtor (`GET /producers/{id}/production-plans`);
- detalhe do plano com **previsto x realizado** e barra de progresso;
- CRUD de apontamentos de colheita (`/production-plans/{id}/executions`);
- CRUD de planos, com culturas e safras vindas de `/crops` e `/harvests`;
- resolução do produtor por papel:
  - **PRODUCER** → `GET /producers/me`, cai direto nos próprios planos;
  - **ADMIN/MANAGER** → tela de seleção de produtor (`GET /producers`);
  - **TECHNICIAN** → sem rota de descoberta na API (ver *Limitações*).

## Como o offline funciona

Três peças, em `src/lib`:

**`cache.ts` + `use-cached-query.ts`** — toda leitura é *cache-first*: mostra o
que está no aparelho e revalida em seguida. Sem rede, o cache é a resposta, não
um erro. O rodapé de cada tela informa a idade do dado.

**`outbox.ts`** — toda escrita feita sem conexão vira um item de fila
persistido. A fila é serial e para no primeiro erro que não é culpa do item
(rede caiu, 5xx, 401), para não inverter a ordem de operações do mesmo
recurso. Um 4xx marca só aquele item como *recusado* e a fila segue.

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
├── domain/              contratos da API: auth, producers, production, catalog
├── lib/                 api, cache, outbox, mutate, net, secure, storage, format
├── hooks/               use-cached-query (cache-first + revalidação)
├── contexts/            AuthContext (sessão), SyncContext (rede + fila)
├── navigation/          stack raiz, abas e pilha de planos
├── screens/             login, produtores, planos, detalhe, formulários, sync, perfil
├── components/          banner de estado, estados vazios/erro/carregando
└── theme/               tema Paper alinhado ao emerald do front web
```

## Convenções

- **TypeScript estrito**, com `noUncheckedIndexedAccess`.
- **Named exports** em todo o código de aplicação.
- **Imports ordenados** pelo `eslint-plugin-simple-import-sort`: react/RN →
  externos → alias `@/` → relativos.
- **Alias `@/`** para `src/` (tsconfig paths, resolvido também pelo Metro).
- **Validação com Zod** nas entradas de formulário.
- **Prettier** + `eslint-config-prettier` para não conflitar com o ESLint.

## Limitações conhecidas (backend)

Coisas que travam funcionalidade aqui e valem uma correção no `agro-backend`:

1. **TECHNICIAN não consegue listar produtores.** `GET /producers` exige
   ADMIN/MANAGER e `GET /producers/me` é só de PRODUCER, então o técnico não
   tem como chegar num plano pelo app. Faltaria algo como
   `GET /technicians/me/producers`.
2. **Token expirado responde 500, não 401.** `JwtAuthenticationFilter` deixa a
   `RuntimeException` de `getSubjectFromToken` escapar. O app contorna lendo o
   `exp` localmente, mas o correto seria o filtro devolver 401.
3. **Sem refresh token.** Com 4 h de validade, uma jornada de campo inteira
   exige novo login para sincronizar.

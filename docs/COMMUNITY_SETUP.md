# Ativar Builds da Comunidade

A implementação já está no projeto. O GitHub Pages continua servindo apenas
arquivos estáticos; Supabase guarda as publicações e executa a API, e Cloudflare
Turnstile reduz spam sem exigir login.

## O que você precisa criar

1. Crie um projeto em [Supabase](https://database.new/) e copie o `Project ID`
   (também chamado de `project ref`).
2. No painel da Cloudflare, abra **Turnstile**, crie um widget do tipo
   **Managed** e autorize os hostnames que realmente servem a página:
   `roncetti.com.br` e, se você também usa o endereço padrão do Pages,
   `viniciusron7.github.io`. Inclua também `www.roncetti.com.br` se essa versão
   abre o site sem redirecionar antes.
3. Guarde os dois valores do widget:
   - **Site key**: pública; será colocada no JavaScript.
   - **Secret key**: secreta; será salva somente no Supabase.

Não coloque a secret key do Turnstile, a service-role/secret key do Supabase ou
os segredos HMAC em nenhum arquivo do site.

## Instalar e conectar a CLI

No macOS:

```sh
brew install supabase/tap/supabase
cd /Users/viniciusroncetti/VSCODE/clubs-builder
supabase login
supabase link --project-ref SEU_PROJECT_REF
```

O diretório `supabase/` já está inicializado, então não execute `supabase init`.

## Criar os segredos

Gere dois valores diferentes e copie cada resultado:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Depois configure a função. Troque os textos em maiúsculas:

```sh
supabase secrets set \
  TURNSTILE_SECRET_KEY='SECRET_KEY_DO_TURNSTILE' \
  COMMUNITY_MANAGEMENT_TOKEN_SECRET='PRIMEIRO_VALOR_ALEATORIO' \
  COMMUNITY_RATE_LIMIT_SECRET='SEGUNDO_VALOR_ALEATORIO' \
  COMMUNITY_ALLOWED_ORIGINS='https://roncetti.com.br,https://viniciusron7.github.io' \
  COMMUNITY_TURNSTILE_HOSTNAMES='roncetti.com.br,viniciusron7.github.io' \
  COMMUNITY_TURNSTILE_TEST_MODE='false' \
  COMMUNITY_CHALLENGE_LIMIT='20' \
  COMMUNITY_CHALLENGE_WINDOW_SECONDS='600' \
  COMMUNITY_PUBLISH_LIMIT='5' \
  COMMUNITY_PUBLISH_WINDOW_SECONDS='3600'
```

Se um dos dois domínios não serve a página, remova-o das duas listas. Origins
usam `https://`; hostnames não usam protocolo nem caminho.

## Criar o banco e publicar a função

Ainda na raiz do projeto:

```sh
supabase db push
supabase functions deploy community-builds --use-api
```

O primeiro comando aplica
`supabase/migrations/20260729000000_community_builds.sql`. O segundo publica a
Edge Function com a configuração pública definida em `supabase/config.toml`.
Mantenha `--use-api`: a função importa as mesmas regras de jogo usadas pelo
frontend, que ficam fora do diretório `supabase/`.

## Ligar o frontend

Os dois valores públicos já estão preenchidos em `js/community-config.js`:

```js
const defaults = {
  apiUrl: 'https://czfstgqqkjewbzbcblle.supabase.co/functions/v1/community-builds',
  turnstileSiteKey: '0x4AAAAAAEAjy-lSiXjfRYb1',
};
```

Não coloque a Secret Key do Turnstile nesse arquivo. Depois do deploy do
backend, faça commit/push e aguarde a atualização do GitHub Pages.

## Conferência final

1. Abra **Community Builds**. A tela de “Setup required” deve desaparecer.
2. Abra uma build, clique em **Publish current build**, informe seu nome e um
   nome para a build e conclua a verificação.
3. Reabra o publicador: o nome do autor deve continuar preenchido.
4. A publicação deve aparecer na galeria e abrir o link correto.
5. No mesmo navegador, a publicação deve mostrar **Delete**. Em outro navegador
   ela deve ser somente leitura.

O nome lembrado e as credenciais de exclusão ficam em `localStorage`. Se os
dados do navegador forem apagados, o botão de exclusão desaparece; nesse caso,
você ainda pode ocultar ou apagar a linha pelo painel administrativo do
Supabase. Para moderar sem excluir, altere `status` para `hidden` na tabela
`community_builds`.

Detalhes de API, segurança e teste local estão em
[COMMUNITY_SETUP_BACKEND.md](COMMUNITY_SETUP_BACKEND.md).

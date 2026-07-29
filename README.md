# FC 26 Pro Clubs Builder

Builder de EA FC 26 Clubs implementado sem framework, usando HTML, CSS e JavaScript puro.
Permite montar, otimizar, compartilhar e exportar builds de jogador.

## Como rodar

Use um servidor local. O navegador bloqueia recursos usados pelo dataset UT, pelo Web Worker,
pelo canvas e pelo clipboard quando a página é aberta diretamente por `file://`.

  ```bash
  cd clubs-builder
  python3 -m http.server 4173 --bind 0.0.0.0
  # abra http://localhost:4173
  ```

## O que está incluído (paridade com o original)

- **Archetypes** (13: 2 GK, 4 DEF, 4 MID, 3 FWD) com filtro por posição.
- **Atributos** — 8 categorias, com sistema de **AP (Attribute Points)** fiel:
  total por nível, custo por ponto que depende de tier + valor, key attributes com
  desconto de tier. O nível máximo é **100**, com **3167 AP** totais. Editor com +/−,
  slider, custo do próximo ponto e breakdown.
- **Body** — altura/peso (limitados ao archetype) ajustam atributos pela fórmula real;
  cálculo do **AcceleRATE** (Explosive/Lengthy/Controlled).
- **PlayStyles** (modal) — 4 **signature** (viram "+" nos níveis 30/50/75/95) + 9 slots regulares
  por nível (1/10/20/40/60/70/80/90/95). PlayStyles ainda bloqueados têm **Quick Unlock**,
  que compra os requisitos com o cálculo central de AP, respeitando máximo do arquétipo e AP disponível.
- **Specializations** (modal) — 3 por archetype, com requisitos de atributo; desbloqueiam ao atingir
  ou via **Quick Unlock** (gasta AP). Somente uma Specialization pode ficar ativa por vez, substituindo
  um dos 4 slots de signature pelo seu PlayStyle+.
- **Posições + OVR estimado** — escolha 1+ posições de linha; GK é automático para goleiros.
  Cada posição é calculada independentemente por `js/weights.js` usando somente atributos comprados:
  `OVR = floor(intercepto + Σ peso·atributo) - 1`, limitado a 1–99. Altura e peso alteram atributos
  efetivos de partida, não o OVR estimado do lobby. A tolerância esperada é ±1.
- O modelo v2 foi validado nas cartas base Common/Rare: 93,43% exato e 99,995% dentro de ±1
  em 19.363 jogadores de linha; 88,05% exato e 100% ±1 nos 2.528 jogadores 75+; 98,05% exato
  e 100% ±1 em 2.303 goleiros.
- **Otimizar Overall** (modal) — dois modos:
  1. *Maximizar overall dado AP* (adicional): aloca AP pra subir o overall ao máximo.
  2. *Mínimo AP dado overall*: acha os níveis de atributo p/ atingir o overall alvo gastando o mínimo de AP.
  Com **múltiplas posições** usa MinMax (maximiza o menor OVR, depois a soma e por fim minimiza AP).
  A busca roda em Web Worker com poda de Pareto e limites de 250.000 estados/2 segundos. O resultado
  informa `optimal` quando há prova ou `best-found` quando a busca limitada devolve o melhor encontrado.
  Antes de aplicar, custo, limites e OVRs são recalculados, AP sem efeito no objetivo é removido e alvos
  impossíveis exibem o maior OVR realmente alcançável. Fechar o modal cancela uma busca em andamento.
  Os atributos já evoluídos são mantidos como piso.
  No modal dá pra **excluir atributos** (chip cinza/riscado): o otimizador não gasta AP neles — eles ficam
  fixos, mas ainda contam no overall pelo valor atual.
- **Maximizar Soma de Atributos** (botão "Σ Max Sum") — escolha os atributos (chips, com All/None) e um
  orçamento de AP; distribui o AP pra **maximizar a soma** desses atributos (compra os pontos mais baratos
  primeiro). Independe de posição; mantém os evoluídos como piso.
- **Atletas UT** — lista compacta 80+, custo calculado pelos mesmos tiers do editor e cap no máximo
  do arquétipo.
- **Desfazer/refazer** — botões e atalhos Ctrl/Cmd+Z, Ctrl/Cmd+Y e Cmd+Shift+Z.
- **Compartilhar via URL** (`?b=...`, formato v2 com leitura de links v1) e
  **salvar como imagem** com os OVRs estimados por posição.
- **Builds da Comunidade** — galeria pública sem conta: o autor informa seu nome
  e o nome da build, o navegador memoriza o autor e guarda localmente a credencial
  de exclusão daquela publicação. O backend opcional usa Supabase + Cloudflare
  Turnstile, com RLS, validação, CORS e limite de publicações.

As 4 abas (PlayStyles / Specializations / Body / Community Builds) abrem **modais**;
a área principal mostra os atributos + o painel de detalhe do atributo selecionado.

## Estrutura

```
clubs-builder/
  index.html          # entrada do site no GitHub Pages
  site.webmanifest    # metadados de instalação/PWA
  assets/
    fonts/            # família Cruyff Sans usada pela interface
    ui/               # ícones próprios da interface (AP e Key Attribute)
  archetypes/         # ícones SVG dos arquétipos
  playstyles/         # ícones PNG dos PlayStyles e PlayStyles+
  css/
    vendor.css        # Tailwind compilado, reaproveitado do original
    app.css           # complementos (utilitários ausentes + ajustes)
  js/
    data.js           # TODOS os dados do jogo (extraídos e normalizados)
    calc.js           # mecânicas puras (AP, body, PlayStyles, elegibilidade…)
    optimizer-worker.js # solver multi-position fora da thread da interface
    history.js        # histórico imutável de undo/redo
    share.js          # URL (encode/decode) + export de imagem (canvas)
    community-config.js # URL e site key públicas da galeria
    community.js      # cliente da API + cache local + Turnstile
    app.js            # estado + render + eventos
  data/               # dataset UT compacto usado pela interface
  supabase/           # migration e Edge Function de Community Builds
  docs/               # ativação e contrato técnico do backend
  tests/              # testes node:test + smoke test no navegador
```

## Ativar Builds da Comunidade

A interface já funciona em estado de configuração, mas publicar e listar builds
depende do backend. Siga [docs/COMMUNITY_SETUP.md](docs/COMMUNITY_SETUP.md).
As credenciais secretas ficam no Supabase; somente a URL da função e a site key
pública do Turnstile entram em `js/community-config.js`.

## Notas

- Os dados foram extraídos fielmente dos chunks do build original (archetypes, atributos,
  PlayStyles, tabelas de custo de AP e de AP por nível, traduções EN).
- A interface é só em inglês (como o conteúdo-base).
- O encoding da URL é próprio (compacto), **não** é compatível com o clubsbuilder.com.
- Execute `node --test tests/*.test.js` para validar cálculos, modelo, solver,
  compartilhamento e histórico.
- A validação estatística completa do modelo usa o CSV original opcional:
  `EAFC26_VALIDATION_CSV=/caminho/eafc26_ut_players.csv node --test tests/model-validation.test.js`.
  Sem ele, somente esse teste pesado é ignorado; a suíte funcional permanece autocontida.

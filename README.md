# DOC CSC · Envie seu currículo (site do candidato)

Site público, com a identidade DOC CSC, que faz **apenas uma coisa**: receber o currículo do candidato (PDF ou DOCX, até 4 MB), ler o texto e cadastrar no **mesmo banco de talentos** usado pelo sistema interno.

Não existe pesquisa, visualização, download nem exclusão aqui: a única rota é `POST /api/candidates`. Quem tiver o link consegue enviar currículo, e nada mais — a consulta continua só no sistema interno (`trabalheaqui`).

## Como publicar na Vercel

1. Crie um repositório novo no GitHub com estes arquivos (ex.: `trabalheaqui-candidato`).
2. Na Vercel: **Add New → Project**, importe esse repositório. O framework é detectado como Vite; não há nada a mudar no build.
3. Em **Settings → Environment Variables**, use **o mesmo banco do sistema interno** para que os currículos caiam na mesma base:
   - `DATABASE_URL` (ou `POSTGRES_URL`) — **obrigatória**. Copie o valor exato do projeto `trabalheaqui` (Vercel → projeto interno → Settings → Environment Variables), ou conecte o mesmo banco Neon a este projeto pelo Marketplace.
   - `BLOB_READ_WRITE_TOKEN` — opcional; se o sistema interno usa Blob, use o mesmo token aqui, senão o arquivo é guardado no próprio Postgres.
   - `OPENAI_API_KEY` — opcional. Com ela, a IA identifica profissão, cidade, setores e experiência no momento do envio; sem ela, uma extração local mais simples é usada e o texto completo fica indexado do mesmo jeito.
   - `OPENAI_MODEL` — opcional (padrão `gpt-4.1-mini`).
   - `APP_PASSWORD` — **não defina** neste projeto. Se definir, o candidato precisará digitar senha e o envio deixa de funcionar pelo link público.
4. Deploy. O endereço gerado (ex.: `trabalheaqui-candidato.vercel.app`) é o link para mandar aos candidatos.

> A tabela `candidates` é criada automaticamente no primeiro envio, se ainda não existir (`db/schema.sql` tem o script equivalente).

## Formatos aceitos

Somente **PDF** (`.pdf`) e **Word** (`.docx`), com o currículo em **texto**, até 4 MB.

Recusados, com mensagem explicando o motivo e como resolver:

- imagens (`.jpg`, `.jpeg`, `.png`, `.heic`, `.heif`, `.webp`, `.gif`, `.bmp`, `.tif`) e outros formatos;
- `.doc` (Word antigo) — o candidato é orientado a salvar como `.docx` ou PDF;
- **PDF que é foto ou digitalização** do currículo: o texto é extraído no navegador com o pdf.js e o arquivo é recusado quando nenhuma página tem texto, ou quando o texto útil fica abaixo de 350 caracteres / 60 palavras (marcas de scanner como "Scanned by CamScanner" e numeração de página são descontadas antes da conta);
- arquivo com extensão trocada: a assinatura do arquivo é conferida (`%PDF` para PDF, `PK` para `.docx`), então um JPG renomeado para `.pdf` não passa.

As regras estão em `lib/curriculo-texto.js` e valem nos **dois lados**: na tela (`src/main.jsx`) e na API (`api/candidates.js`), de modo que nem o envio pelo "Compartilhar" do celular nem uma chamada direta ao endpoint escapam. Os limites ficam em `LIMITES` e as mensagens em `MSG`, nesse mesmo arquivo.

## Como funciona para o candidato

1. Abre o link, lê o aviso de formatos e toca em **Toque para escolher o currículo** para selecionar o PDF ou `.docx`.
2. Toca em **Enviar currículo**. O texto é lido no próprio navegador e enviado junto com o arquivo.
3. Aparece o pop-up **"Currículo cadastrado!"**; ao fechar, a tela volta limpa, pronta para outro envio.

No Android, o site pode ser instalado como app e aparece no menu **Compartilhar** do WhatsApp: o candidato compartilha o currículo e o envio acontece sozinho. No iPhone, o iOS não permite isso — o caminho é **Compartilhar → Salvar em Arquivos** e depois escolher o arquivo no site.

## Observações

- Página marcada com `noindex`: não aparece em buscas do Google. O link circula por quem você enviar.
- Sendo um link público, qualquer pessoa com ele pode enviar um currículo. Não há como ler ou apagar dados por este site.
- LGPD: o rodapé e o aviso na tela informam que os dados são usados em processos seletivos do DOC CSC. Se sua política exigir consentimento explícito, um checkbox pode ser adicionado antes do botão de envio.

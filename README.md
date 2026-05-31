# Prepara Prova IA

Sistema web para organizar materias, conteudos, revisoes, quizzes, desafios e simulados de estudo. A ideia e ajudar o aluno a saber o que estudar primeiro, praticar respostas e acompanhar a evolucao ate a prova.

## Como o sistema funciona

O projeto tem duas partes principais:

- **Frontend React/Vite** em `src/`: interface do aluno, com dashboard, materias, conteudos, quiz, desafios, simulados, previsao de prova, relatorios, conquistas e ranking pessoal.
- **Backend Express** em `server/`: API que salva e consulta os dados, gera ciclos de estudo, avalia respostas, importa materiais e integra o Professor IA.

O fluxo normal e:

1. O aluno entra pelo nome ou pelo login Google.
2. O sistema usa esse usuario para separar os dados de cada aluno.
3. O aluno cadastra materias, data da prova, dificuldade, peso e horas desejadas.
4. Depois cadastra conteudos manualmente ou importa material em PDF/TXT.
5. O sistema gera perguntas, desafios, revisoes e simulados.
6. As respostas atualizam status, confianca, acertos, XP, relatorios e prioridades de estudo.

## Principais recursos

- Cadastro de materias e conteudos.
- Importacao de material por texto, PDF ou TXT.
- Dashboard com horas estudadas, aproveitamento, desafios pendentes e proximas provas.
- Quiz de revisao e desafios discursivos.
- Simulados com quantidade configuravel de questoes.
- Previsao de prova por professor, materia, data e nota alvo.
- Relatorios de desempenho e temas em risco.
- Sistema de progresso com XP, nivel, conquistas e ranking pessoal.
- Correcao local e, quando configurado, correcao com IA.
- Dados do aluno salvos no Google Drive App Data da propria conta Google, quando o login Google autoriza o Drive.

## Tecnologias usadas

- Node.js
- Express
- React
- Vite
- SQLite com `better-sqlite3`
- Multer para upload de arquivos
- `pdf-parse` para leitura de PDFs
- Google Gemini para o Professor IA

## Estrutura do projeto

```text
.
|-- src/                 # Interface React
|-- server/              # API Express e banco local
|   |-- index.js         # Rotas da API e inicializacao do servidor
|   |-- database.js      # Tabelas SQLite e funcoes auxiliares
|   |-- gemini-professor.js
|   |-- data/            # Banco SQLite criado automaticamente
|   `-- uploads/         # Arquivos enviados pelo usuario
|-- dist/                # Build de producao gerado pelo Vite
|-- package.json         # Scripts do projeto
|-- vite.config.js       # Porta do Vite e proxy para API
`-- .env.example         # Exemplo de configuracao
```

## Configuracao inicial

Instale as dependencias:

```bash
npm install
```

Crie o arquivo `.env` a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

Depois abra o `.env` e preencha as chaves necessarias:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=sua_chave_gemini
GEMINI_MODEL=gemini-2.0-flash
OPENAI_API_KEY=seu_token_openai_opcional
OPENAI_MODEL=gpt-4.1-mini
AI_PROFESSOR_ENABLED=true
VITE_GOOGLE_CLIENT_ID=seu_google_client_id_opcional
```

Observacao: se `GEMINI_API_KEY` nao estiver configurada, o sistema ainda liga, mas o Professor IA externo fica indisponivel. Nesse caso, a correcao local continua funcionando.

Para o login Google funcionar localmente, o OAuth Client do Google Cloud precisa liberar estas origens em **Authorized JavaScript origins**:

```text
http://127.0.0.1:5173
http://localhost:3333
http://127.0.0.1:3333
```

Em desenvolvimento, a entrada principal e `http://127.0.0.1:5173`. Depois do build de producao, o Express serve o sistema em `http://localhost:3333`.

Para salvar os dados no Drive do proprio aluno, tambem ative a **Google Drive API** no Google Cloud e adicione este escopo no OAuth Consent Screen:

```text
https://www.googleapis.com/auth/drive.appdata
```

O sistema cria um arquivo privado chamado `prepara-prova-ia-data.json` na area App Data do Drive do aluno. Esse arquivo nao aparece nos arquivos comuns do Drive e pertence a conta Google do proprio aluno.

## Como ligar no terminal

Para rodar em modo desenvolvimento, use:

```bash
npm run dev
```

Esse comando inicia duas coisas ao mesmo tempo:

- API backend: `http://localhost:3333`
- Interface web: `http://127.0.0.1:5173`

Abra no navegador:

```text
http://127.0.0.1:5173
```

O Vite envia automaticamente as chamadas `/api` e `/uploads` para o backend na porta `3333`.

## Rodar somente a API

```bash
npm run dev:api
```

Ou sem modo watch:

```bash
npm start
```

## Rodar somente a interface

```bash
npm run dev:web
```

## Build de producao

Gere os arquivos finais da interface:

```bash
npm run build
```

Depois inicie o servidor:

```bash
npm start
```

Em producao, o Express serve a pasta `dist/`. Acesse:

```text
http://localhost:3333
```

## Testes e manutencao

Rodar teste rapido da API:

```bash
npm test
```

Rodar teste de interface:

```bash
npm run test:ui
```

Resetar os dados locais:

```bash
npm run reset:data
```

## Onde os dados ficam salvos

Quando o aluno entra com Google e autoriza o Drive, materias, conteudos, desafios, simulados e progresso ficam no **Google Drive App Data do proprio aluno**.

Se o aluno entra manualmente sem Google, ou se o Drive nao for autorizado, o sistema usa o armazenamento local do navegador como fallback.

O backend local ainda possui SQLite para testes e execucao fora do modo Drive. O banco SQLite e criado automaticamente em:

```text
server/data/estudos.db
```

Os arquivos enviados pelo usuario ficam em:

```text
server/uploads/
```

Se quiser usar outro caminho para o banco, configure no `.env`:

```env
DATABASE_PATH=caminho/do/seu/banco.db
```

## Rotas principais da API

- `GET /api/health`: verifica se a API esta online.
- `GET /api/dashboard`: dados resumidos do dashboard.
- `GET/POST/PATCH/DELETE /api/subjects`: materias.
- `POST /api/import-material`: importacao de material.
- `POST/PATCH/DELETE /api/topics`: conteudos.
- `GET /api/quiz`: quiz de revisao.
- `GET/POST/PATCH/DELETE /api/challenges`: desafios.
- `GET /api/exam`: simulados.
- `GET /api/report`: relatorios.
- `GET/POST/PATCH/DELETE /api/predictions`: previsao de prova.
- `GET /api/ai-professor/status`: status da IA.

## Dicas comuns

- Se a tela nao abrir, confirme se o terminal esta mostrando o Vite na porta `5173`.
- Se a API falhar ao iniciar, confira o `.env`, principalmente `GEMINI_API_KEY`.
- Se a porta `3333` estiver ocupada, defina outra porta antes de iniciar:

```powershell
$env:PORT=3334
npm start
```

- Em desenvolvimento, prefira `npm run dev`, porque ele liga frontend e backend juntos.

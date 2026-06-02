# Estuda+

Plataforma de quiz por materia/professor com dados persistidos em SQLite.

## Rodar localmente

```bash
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:3333`

## Persistencia dos dados

Por padrao, o banco fica em:

```text
server/data/estuda-plus.db
```

Tudo que for cadastrado fica salvo nesse arquivo:

- professores
- materias
- questoes
- alternativas
- tentativas
- respostas
- historico/ranking

## Backup e restauracao

No menu `Cadastrar`, use:

- `Exportar`: baixa um arquivo JSON com todos os dados.
- `Importar`: aceita backup completo ou um arquivo simples com perguntas.

A importacao substitui os dados atuais pelo conteudo do backup.

Se o arquivo for um backup completo exportado pelo sistema, a importacao substitui todos os dados atuais.

Se o arquivo for uma lista simples de perguntas, as perguntas sao adicionadas sem apagar os dados atuais.

### Modelo simples para importar perguntas

Salve no Bloco de Notas como `minhas-questoes.json`, tipo `Todos os arquivos`, codificacao `UTF-8`.

```json
{
  "questions": [
    {
      "professor": "Giovanni",
      "subject": "FullStack",
      "statement": "Qual e a principal diferenca entre Pydantic e SQLAlchemy?",
      "alternatives": [
        "Ambas servem apenas para criar tabelas.",
        "Pydantic valida dados; SQLAlchemy manipula registros do banco.",
        "SQLAlchemy valida entrada; Pydantic salva no banco.",
        "Ambas tem exatamente a mesma funcao."
      ],
      "correctIndex": 1,
      "icon": "BookOpen",
      "color": "#1677ff",
      "difficulty": "Media"
    }
  ]
}
```

Tambem pode marcar a alternativa correta assim:

```json
{
  "questions": [
    {
      "professor": "Giovanni",
      "subject": "FullStack",
      "statement": "Por que usamos exclude_unset=True em uma rota PATCH?",
      "alternatives": [
        { "text": "Para deixar a consulta mais rapida.", "correct": false },
        { "text": "Para criptografar os dados.", "correct": false },
        { "text": "Para impedir que campos nao enviados sejam atualizados.", "correct": true },
        { "text": "Para validar o token JWT.", "correct": false }
      ],
      "icon": "BookOpen",
      "color": "#1677ff"
    }
  ]
}
```

## Deploy

Para deploy, use uma plataforma com armazenamento persistente para o SQLite, ou configure um banco externo futuramente.

Variaveis suportadas:

```text
DATA_DIR=/caminho/do/disco/persistente
```

ou

```text
DATABASE_PATH=/caminho/do/disco/persistente/estuda-plus.db
```

Importante: se a plataforma apagar arquivos entre deploys, o SQLite local tambem sera apagado. Nesse caso, use `Exportar` antes do deploy ou configure um volume/disco persistente.

## Migrar dados para o ambiente online

O processo recomendado e:

1. Rode o app localmente com os dados ja importados:

```bash
npm run dev
```

2. Exporte os dados locais para um JSON:

```bash
npm run backup:export -- --from http://127.0.0.1:3333 --out backups/local.json
```

3. Restaure esse JSON no ambiente online:

```bash
npm run backup:restore -- --to https://seu-app-online.com --file backups/local.json --yes
```

Tambem da para fazer exportacao local e restauracao online em um unico comando:

```bash
npm run backup:migrate -- --from http://127.0.0.1:3333 --to https://seu-app-online.com --yes
```

Para importar apenas um arquivo simples de perguntas no ambiente online, sem apagar os dados atuais:

```bash
npm run questions:import -- --to https://seu-app-online.com --file minhas-questoes.json
```

Observacao: `backup:restore` e `backup:migrate` substituem os dados do destino pelo conteudo do backup. Use sempre depois de conferir a URL online.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const port = 4555;
const baseUrl = `http://127.0.0.1:${port}`;
const testDbPath = path.join(os.tmpdir(), `estudafoco-ui-${Date.now()}.db`);
const chromePath = findChrome();

if (!chromePath) {
  throw new Error("Chrome nao encontrado para o teste de interface.");
}

const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATABASE_PATH: testDbPath, AI_PROFESSOR_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

try {
  await waitForServer();

  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("[GSI_LOGGER]")) browserErrors.push(text);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });

  await page.type("#student", "Usuario Teste");
  await clickButton(page, "Entrar");
  await page.waitForSelector(".appShell");
  await expectText(page, "Dashboard");

  await clickButton(page, "Matérias");
  await expectText(page, "Cadastrar Matéria");
  await page.type('input[placeholder="Engenharia de Software"]', "Matéria Importada");
  await page.type('input[type="date"]', "2026-06-30");
  await clickButton(page, "Salvar matéria");
  await expectText(page, "Matéria salva");
  await expectText(page, "Cadastrar Conteúdo");

  await page.type('input[placeholder="Scrum"]', "Scrum organiza o trabalho em sprints. Product Owner prioriza o backlog. Daily Scrum acompanha impedimentos.");
  const textareas = await page.$$("textarea");
  await textareas[0].type("Explique o tema com suas palavras.");
  await textareas[1].type("Scrum organiza o trabalho em sprints. Product Owner prioriza o backlog. Daily Scrum acompanha impedimentos.");
  await clickButton(page, "Salvar conteúdo");
  await expectText(page, "Conteúdo salvo");
  await expectText(page, "Desafios");

  await clickButton(page, "Desafios");
  await expectText(page, "Corrigir com IA Professor");
  await page.click('button[title="Ver resposta"]');
  await expectText(page, "Resposta-base");
  const referenceAnswer = await page.$eval(".challengeAnswerBox p", (item) => item.textContent);
  await page.click('button[title="Editar desafio"]');
  await expectText(page, "Editar desafio");
  await clickButton(page, "Cancelar");
  const challengeTextareas = await page.$$("textarea");
  await challengeTextareas[0].type(referenceAnswer);
  await clickButton(page, "Corrigir com IA Professor");
  await expectText(page, "Resposta correta");
  page.once("dialog", (dialog) => dialog.accept());
  await page.click('button[title="Excluir desafio"]');
  await expectText(page, "Desafio excluído");

  await clickButton(page, "Matérias");
  await expectText(page, "Cadastrar Matéria");
  await page.type('input[placeholder="Engenharia de Software"]', "Direito Constitucional");
  await page.type('input[type="date"]', "2026-06-30");
  await clickButton(page, "Salvar matéria");
  await expectText(page, "Matéria salva");
  await expectText(page, "Cadastrar Conteúdo");

  await page.type('input[placeholder="Scrum"]', "Controle de Constitucionalidade");
  const textareasRound2 = await page.$$("textarea");
  await textareasRound2[0].type("Explique controle de constitucionalidade com suas palavras.");
  await textareasRound2[1].type("Controle de constitucionalidade verifica se leis e atos normativos respeitam a Constituicao.");
  await clickButton(page, "Salvar conteúdo");
  await expectText(page, "Conteúdo salvo");
  await expectText(page, "Desafios");

  await clickButton(page, "Previsão");
  await expectText(page, "Cadastrar prova");
  await page.type('input[placeholder="Nome do professor"]', "Prof. Teste");
  await page.type('input[placeholder="Matéria da prova"]', "Direito Constitucional");
  await page.type('input[type="date"]', "2026-07-15");
  await page.type('input[placeholder="8.0"]', "8.0");
  await clickButton(page, "Salvar prova");
  await expectText(page, "Prova cadastrada");
  await expectText(page, "Direito Constitucional");

  await clickButton(page, "Simulados");
  await clickButton(page, "Gerar simulado");
  await expectText(page, "Finalizar simulado");
  await clickButton(page, "Finalizar simulado");
  await expectText(page, "Simulado finalizado");
  await expectText(page, "Dashboard");

  await page.click('button[title="Atualizar"]');
  await expectText(page, "Dados atualizados");

  if (browserErrors.length > 0) {
    throw new Error(`Erros no navegador:\n${browserErrors.join("\n")}`);
  }

  console.log("Teste UI passou: login, navegacao, cadastros, IA/ciclo, simulado e atualizar responderam aos cliques.");
} finally {
  await browser.close();
  server.kill();
  await delay(250);
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Servidor nao iniciou em ${baseUrl}.\n${output}`);
}

async function clickButton(page, text) {
  await page.waitForFunction((needle) => {
    return [...document.querySelectorAll("button")].some((button) => button.textContent.includes(needle));
  }, {}, text);

  await page.evaluate((needle) => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes(needle));
    button.click();
  }, text);
}

async function expectText(page, text) {
  await page.waitForFunction((needle) => document.body.textContent.includes(needle), {}, text);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

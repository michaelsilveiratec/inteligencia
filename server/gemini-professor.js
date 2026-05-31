import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não está configurada. Adicione ao arquivo .env ou desative o Professor IA.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.0-flash" });
}

export async function generateProfessorQuestions(title, summary = "", subject = "", difficulty = "Medio") {
  try {
    const prompt = `Você é um professor especialista em educação. Crie 5 perguntas pedagógicas sobre o tópico "${title}" para ajudar o aluno a estudar.

${summary ? `Resumo do tópico:\n${summary}\n` : ""}
${subject ? `Matéria: ${subject}\n` : ""}
Nível de dificuldade: ${difficulty}

Crie perguntas que:
1. Explorem conceitos centrais
2. Usem exemplos práticos
3. Desafiem o pensamento crítico
4. Variem entre objetivas e discursivas
5. Sejam adequadas ao nível de dificuldade

Responda em JSON com este formato:
{
  "questions": [
    {
      "question": "Pergunta aqui?",
      "type": "objetiva|discursiva|verdadeiro_falso",
      "difficulty": "${difficulty}",
      "tips": "Dicas para responder"
    }
  ]
}`;

    const result = await getGeminiModel().generateContent(prompt);
    const responseText = result.response.text();
    
    // Extrair JSON da resposta
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Não foi possível extrair JSON da resposta");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.questions;
  } catch (error) {
    console.error("Erro ao gerar perguntas com a IA Professor:", error);
    throw error;
  }
}

export async function generateProfessorFeedback(question, studentAnswer, correctAnswer) {
  try {
    const prompt = `Você é um professor experiente avaliando uma resposta de aluno.

Pergunta: ${question}
Resposta do aluno: ${studentAnswer}
Resposta ideal: ${correctAnswer}

Forneça:
1. Uma avaliação breve (certo/parcialmente correto/errado)
2. Explicação do que o aluno acertou
3. Explicação do que faltou
4. Dica para melhorar
5. Referência conceitual

Responda em JSON:
{
  "status": "correto|parcial|incorreto",
  "score": 0-100,
  "explanation": "...",
  "missed": "...",
  "improvement": "...",
  "concept": "..."
}`;

    const result = await getGeminiModel().generateContent(prompt);
    const responseText = result.response.text();
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Não foi possível extrair JSON da resposta");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Erro ao gerar feedback com a IA Professor:", error);
    throw error;
  }
}

export async function testProfessor() {
  try {
    console.log("🤖 Testando IA Professor com Gemini...\n");
    
    const questions = await generateProfessorQuestions(
      "Fotossíntese",
      "Processo de conversão de energia solar em energia química",
      "Biologia",
      "Médio"
    );

    console.log("✅ Perguntas geradas com sucesso!");
    console.log(JSON.stringify(questions, null, 2));

    console.log("\n" + "=".repeat(60));
    console.log("🧪 Testando feedback...\n");

    const feedback = await generateProfessorFeedback(
      "Qual é a fórmula da fotossíntese?",
      "6CO2 + H2O + luz = C6H12O6 + O2",
      "6CO2 + 6H2O + energia luminosa = C6H12O6 + 6O2"
    );

    console.log("✅ Feedback gerado com sucesso!");
    console.log(JSON.stringify(feedback, null, 2));

    return { success: true, questions, feedback };
  } catch (error) {
    console.error("❌ Erro no teste:", error.message);
    return { success: false, error: error.message };
  }
}

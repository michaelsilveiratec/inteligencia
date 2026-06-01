const DATA_FILE_NAME = "prepara-prova-ia-data.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const LOCAL_PREFIX = "prepara:driveData:";

let nativeFetchRef = null;
let tokenClient = null;
let accessToken = "";
let activeProfile = null;
let activeGoogleClientId = "";
let driveStatus = { mode: "local", connected: false, message: "Usando armazenamento local." };
let googleScriptPromise = null;

export function setStudentDriveProfile(profile, googleClientId) {
  activeProfile = profile || null;
  activeGoogleClientId = googleClientId || "";
}

export async function connectStudentDrive(profile = activeProfile, googleClientId = activeGoogleClientId, interactive = true) {
  setStudentDriveProfile(profile, googleClientId);
  if (!profile?.googleSub && !profile?.email) {
    driveStatus = { mode: "local", connected: false, message: "Entre com Google para sincronizar no Drive." };
    return driveStatus;
  }

  try {
    await ensureDriveToken(interactive);
    await loadStore();
    driveStatus = { mode: "drive", connected: true, message: "Dados sincronizados no Google Drive do aluno." };
  } catch (error) {
    driveStatus = { mode: "local", connected: false, message: error.message || "Drive indisponível; usando armazenamento local." };
  }
  return driveStatus;
}

export function getStudentDriveStatus() {
  return driveStatus;
}

export function installStudentDriveApi() {
  if (typeof window === "undefined" || window.__studentDriveApiInstalled) return;
  nativeFetchRef = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.startsWith("/api/")) return nativeFetchRef(input, init);
    try {
      const response = await handleLocalApi(url, init);
      if (response) return response;
    } catch (error) {
      return jsonResponse({ error: error.message || "Erro no armazenamento do aluno." }, 500);
    }
    return nativeFetchRef(input, init);
  };
  window.__studentDriveApiInstalled = true;
}

async function ensureDriveToken(interactive = false) {
  if (accessToken) return accessToken;
  if (!activeGoogleClientId) throw new Error("VITE_GOOGLE_CLIENT_ID não está configurado.");
  await loadGoogleIdentityScript();
  if (!window.google?.accounts?.oauth2) throw new Error("Google OAuth ainda não carregou.");

  tokenClient ||= window.google.accounts.oauth2.initTokenClient({
    client_id: activeGoogleClientId,
    scope: DRIVE_SCOPE,
    callback: () => {}
  });

  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response?.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      accessToken = response?.access_token || "";
      if (!accessToken) {
        reject(new Error("Não foi possível autorizar o Google Drive."));
        return;
      }
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  googleScriptPromise ||= new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar Google Identity.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Falha ao carregar Google Identity."));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

async function handleLocalApi(url, init) {
  const parsed = new URL(url, window.location.origin);
  const method = String(init.method || "GET").toUpperCase();
  const path = parsed.pathname;

  if (method === "GET" && path === "/api/health") return jsonResponse({ ok: true, app: "Prepara Prova IA", storage: driveStatus.mode });
  if (method === "GET" && path === "/api/dashboard") return jsonResponse(buildDashboard(await loadStore()));
  if (method === "GET" && path === "/api/subjects") return jsonResponse((await loadStore()).subjects);
  if (method === "GET" && path === "/api/quiz") return jsonResponse(buildQuizPlan(allTopics(await loadStore())));
  if (method === "GET" && path === "/api/predictions") return jsonResponse((await loadStore()).predictions);
  if (method === "GET" && path === "/api/challenges") return jsonResponse(joinedChallenges(await loadStore()));
  if (method === "GET" && path === "/api/report") return jsonResponse(buildReport(await loadStore()));
  if (method === "GET" && path === "/api/study-cycle") return jsonResponse({ today: buildQuizPlan(allTopics(await loadStore())) });
  if (method === "GET" && path === "/api/ai-professor/status") {
    return jsonResponse({
      configured: driveStatus.connected,
      mode: driveStatus.connected ? "Drive do aluno" : "Armazenamento local",
      provider: driveStatus.mode,
      model: DATA_FILE_NAME
    });
  }

  if (method === "POST" && path === "/api/ai-helper") {
    const body = await readBody(init);
    const title = body.title || "Tema";
    const content = String(body.content || "").replace(/\s+/g, " ").trim();
    const summary = content.split(/[.!?]/).map((item) => item.trim()).filter(Boolean).slice(0, 4).join(". ") || `Resumo inicial para ${title}.`;
    return jsonResponse({ summary, questions: generateQuestions(title, summary), predictionNotes: [] });
  }

  const subjectMatch = path.match(/^\/api\/subjects(?:\/(\d+))?$/);
  if (subjectMatch) return handleSubjects(method, subjectMatch[1], init);

  const topicReviewMatch = path.match(/^\/api\/topics\/(\d+)\/review$/);
  if (topicReviewMatch && method === "PATCH") return handleTopicReview(Number(topicReviewMatch[1]), init);

  const topicMatch = path.match(/^\/api\/topics(?:\/(\d+))?$/);
  if (topicMatch) return handleTopics(method, topicMatch[1], init);

  const quizSubmitMatch = path.match(/^\/api\/quiz\/(\d+)\/submit$/);
  if (quizSubmitMatch && method === "POST") return handleQuizSubmit(Number(quizSubmitMatch[1]), init);

  const predictionMatch = path.match(/^\/api\/predictions(?:\/(\d+))?$/);
  if (predictionMatch) return handlePredictions(method, predictionMatch[1], init);

  const challengeQuizMatch = path.match(/^\/api\/challenges\/(\d+)\/quiz$/);
  if (challengeQuizMatch && method === "GET") return jsonResponse(buildChallengeQuizQuestions(findChallenge(await loadStore(), Number(challengeQuizMatch[1]))));

  const challengeQuizAnswerMatch = path.match(/^\/api\/challenges\/(\d+)\/quiz\/answer$/);
  if (challengeQuizAnswerMatch && method === "POST") return handleChallengeQuizAnswer(Number(challengeQuizAnswerMatch[1]), init);

  const challengeAnswerMatch = path.match(/^\/api\/challenges\/(\d+)\/answer$/);
  if (challengeAnswerMatch && method === "POST") return handleChallengeAnswer(Number(challengeAnswerMatch[1]), init);

  const challengeMatch = path.match(/^\/api\/challenges(?:\/(\d+))?$/);
  if (challengeMatch) return handleChallenges(method, challengeMatch[1], init);

  if (method === "POST" && path === "/api/study-sessions") return handleStudySession(init);
  if (method === "GET" && path === "/api/exam") return jsonResponse(buildExam(await loadStore(), Number(parsed.searchParams.get("count") || 10)));
  if (method === "POST" && path === "/api/import-material") return handleImportMaterial(init);

  return null;
}

async function handleSubjects(method, id, init) {
  const store = await loadStore();
  if (method === "POST") {
    const body = await readBody(init);
    const subject = {
      id: nextId(store),
      name: String(body.name || "").trim(),
      professor: String(body.professor || "").trim(),
      exam_date: body.exam_date || null,
      weight: numberInRange(body.weight, 1, 5, 3),
      difficulty: numberInRange(body.difficulty, 1, 5, 3),
      desired_hours: numberInRange(body.desired_hours, 1, 40, 6),
      created_at: new Date().toISOString(),
      topics: []
    };
    if (!subject.name) return jsonResponse({ error: "Nome da matéria é obrigatório." }, 400);
    store.subjects.unshift(subject);
    await saveStore(store);
    return jsonResponse(subject, 201);
  }

  const subject = store.subjects.find((item) => item.id === Number(id));
  if (!subject) return jsonResponse({ error: "Matéria não encontrada." }, 404);

  if (method === "PATCH") {
    const body = await readBody(init);
    Object.assign(subject, {
      name: String(body.name ?? subject.name).trim(),
      professor: String(body.professor ?? subject.professor ?? "").trim(),
      exam_date: body.exam_date || null,
      weight: numberInRange(body.weight ?? subject.weight, 1, 5, 3),
      difficulty: numberInRange(body.difficulty ?? subject.difficulty, 1, 5, 3),
      desired_hours: numberInRange(body.desired_hours ?? subject.desired_hours, 1, 40, 6)
    });
    await saveStore(store);
    return jsonResponse(subject);
  }

  if (method === "DELETE") {
    store.subjects = store.subjects.filter((item) => item.id !== Number(id));
    store.challenges = store.challenges.filter((item) => item.subject_id !== Number(id));
    await saveStore(store);
    return jsonResponse({ ok: true });
  }

  return null;
}

async function handleTopics(method, id, init) {
  const store = await loadStore();
  if (method === "POST") {
    const body = await readBody(init);
    const subject = store.subjects.find((item) => item.id === Number(body.subject_id));
    if (!subject) return jsonResponse({ error: "Matéria inválida." }, 400);
    const topic = makeTopic(store, body, subject);
    subject.topics.unshift(topic);
    syncChallenge(store, subject, topic);
    await saveStore(store);
    return jsonResponse(topic, 201);
  }

  const found = findTopic(store, Number(id));
  if (!found) return jsonResponse({ error: "Conteúdo não encontrado." }, 404);

  if (method === "PATCH") {
    const body = await readBody(init);
    const nextSubject = store.subjects.find((item) => item.id === Number(body.subject_id || found.subject.id));
    if (!nextSubject) return jsonResponse({ error: "Matéria inválida." }, 400);
    if (nextSubject.id !== found.subject.id) {
      found.subject.topics = found.subject.topics.filter((item) => item.id !== found.topic.id);
      nextSubject.topics.unshift(found.topic);
      found.subject = nextSubject;
    }
    Object.assign(found.topic, makeTopic(store, { ...found.topic, ...body, id: found.topic.id }, found.subject));
    syncChallenge(store, found.subject, found.topic);
    await saveStore(store);
    return jsonResponse(found.topic);
  }

  if (method === "DELETE") {
    found.subject.topics = found.subject.topics.filter((item) => item.id !== found.topic.id);
    store.challenges = store.challenges.filter((item) => item.topic_id !== found.topic.id);
    await saveStore(store);
    return jsonResponse({ ok: true });
  }

  return null;
}

async function handleTopicReview(topicId, init) {
  const store = await loadStore();
  const found = findTopic(store, topicId);
  if (!found) return jsonResponse({ error: "Tema não encontrado." }, 404);
  const body = await readBody(init);
  found.topic.review_count = (found.topic.review_count || 0) + 1;
  found.topic.student_confidence = numberInRange(body.student_confidence ?? found.topic.student_confidence, 1, 5, found.topic.student_confidence || 3);
  found.topic.last_reviewed_at = today();
  found.topic.next_review_at = nextDate(found.topic.student_confidence >= 4 ? 7 : 3);
  await saveStore(store);
  return jsonResponse(enrichTopic(found.subject, found.topic));
}

async function handlePredictions(method, id, init) {
  const store = await loadStore();
  if (method === "POST") {
    const body = await readBody(init);
    const plan = {
      id: nextId(store),
      professor: String(body.professor || "").trim(),
      subject: String(body.subject || "").trim(),
      exam_date: body.exam_date || "",
      required_grade: Number(body.required_grade || 0),
      created_at: new Date().toISOString()
    };
    if (!plan.professor || !plan.subject || !plan.exam_date) return jsonResponse({ error: "Preencha professor, matéria e data." }, 400);
    store.predictions.unshift(plan);
    await saveStore(store);
    return jsonResponse(plan, 201);
  }
  const plan = store.predictions.find((item) => item.id === Number(id));
  if (!plan) return jsonResponse({ error: "Prova não encontrada." }, 404);
  if (method === "PATCH") {
    Object.assign(plan, await readBody(init));
    await saveStore(store);
    return jsonResponse(plan);
  }
  if (method === "DELETE") {
    store.predictions = store.predictions.filter((item) => item.id !== Number(id));
    await saveStore(store);
    return jsonResponse({ ok: true });
  }
  return null;
}

async function handleChallenges(method, id, init) {
  const store = await loadStore();
  const challenge = findChallenge(store, Number(id));
  if (!challenge) return jsonResponse({ error: "Desafio não encontrado." }, 404);
  if (method === "PATCH") {
    Object.assign(challenge, await readBody(init));
    await saveStore(store);
    return jsonResponse(challenge);
  }
  if (method === "DELETE") {
    store.challenges = store.challenges.filter((item) => item.id !== challenge.id);
    await saveStore(store);
    return jsonResponse({ ok: true });
  }
  return null;
}

async function handleChallengeAnswer(challengeId, init) {
  const store = await loadStore();
  const challenge = findChallenge(store, challengeId);
  if (!challenge) return jsonResponse({ error: "Desafio não encontrado." }, 404);
  const body = await readBody(init);
  const answer = String(body.answer || "").trim();
  if (!answer) return jsonResponse({ error: "Digite sua resposta antes de enviar." }, 400);
  const evaluation = evaluateAnswer(challenge, answer);
  challenge.last_answer = answer;
  challenge.feedback = evaluation.feedback;
  challenge.score = evaluation.score;
  challenge.attempts = (challenge.attempts || 0) + 1;
  if (evaluation.correct) challenge.status = "Concluido";
  const found = findTopic(store, challenge.topic_id);
  if (found) {
    found.topic.total_answers = (found.topic.total_answers || 0) + 1;
    found.topic.correct_answers = (found.topic.correct_answers || 0) + (evaluation.correct ? 1 : 0);
    found.topic.status = evaluation.correct ? "Dominado" : "Repetir";
    found.topic.student_confidence = evaluation.correct ? Math.min(5, (found.topic.student_confidence || 2) + 1) : Math.max(1, (found.topic.student_confidence || 2) - 1);
  }
  await saveStore(store);
  return jsonResponse({ ...evaluation, status: challenge.status, lockedUntil: challenge.locked_until || null, evaluator: "drive-local" });
}

async function handleQuizSubmit(topicId, init) {
  const store = await loadStore();
  const found = findTopic(store, topicId);
  if (!found) return jsonResponse({ error: "Tema não encontrado." }, 404);
  const body = await readBody(init);
  const questions = found.topic.questions?.length ? found.topic.questions : generateQuestions(found.topic.title, found.topic.summary);
  const question = questions[Number(body.question_index || 0)] || questions[0];
  const evaluation = evaluateAnswer({ ...found.topic, reference_answer: question.answer, prompt: question.question }, body.answer || "");
  found.topic.total_answers = (found.topic.total_answers || 0) + 1;
  found.topic.correct_answers = (found.topic.correct_answers || 0) + (evaluation.correct ? 1 : 0);
  await saveStore(store);
  return jsonResponse({ topic_id: topicId, topic_title: found.topic.title, question: question.question, correct_answer: question.answer, ...evaluation });
}

async function handleChallengeQuizAnswer(challengeId, init) {
  const store = await loadStore();
  const challenge = findChallenge(store, challengeId);
  if (!challenge) return jsonResponse({ error: "Desafio não encontrado." }, 404);
  const body = await readBody(init);
  const questions = buildChallengeQuizQuestions(challenge);
  const question = questions[Number(body.questionIndex || 0)] || questions[0];
  const correct = Number(body.selectedOption) === question.correctIndex;
  return jsonResponse({
    correct,
    explanation: question.explanation,
    correct_option: String.fromCharCode(65 + question.correctIndex),
    correct_answer: question.options[question.correctIndex]?.text || ""
  });
}

async function handleStudySession(init) {
  const store = await loadStore();
  const body = await readBody(init);
  store.studySessions.unshift({
    id: nextId(store),
    topic_id: Number(body.topic_id),
    minutes: numberInRange(body.minutes, 0, 600, 30),
    session_type: body.session_type || "Estudo",
    studied_at: new Date().toISOString()
  });
  await saveStore(store);
  return jsonResponse({ ok: true });
}

async function handleImportMaterial(init) {
  const store = await loadStore();
  const body = await readBody(init);
  const subject = store.subjects.find((item) => item.id === Number(body.subject_id)) || store.subjects[0];
  if (!subject) return jsonResponse({ error: "Cadastre uma matéria antes de importar." }, 400);
  const content = String(body.content || "").trim();
  if (!content) return jsonResponse({ error: "Cole um material para importar." }, 400);
  const title = String(body.main_theme || content.split(/[.!?]/)[0] || "Material importado").slice(0, 80);
  const topic = makeTopic(store, { subject_id: subject.id, title, summary: content.slice(0, 600), questions: "" }, subject);
  subject.topics.unshift(topic);
  syncChallenge(store, subject, topic);
  await saveStore(store);
  return jsonResponse({ subject_id: subject.id, topics_created: 1, topics: [topic], detected_keywords: importantTokens(content).slice(0, 8) }, 201);
}

function makeTopic(store, body, subject) {
  const title = String(body.title || "").trim();
  const summary = String(body.summary || body.notes || "").trim();
  const questions = normalizeQuestions(body.questions, title, summary);
  return {
    id: Number(body.id) || nextId(store),
    subject_id: subject.id,
    title,
    summary: questions[0]?.answer || summary,
    difficulty: numberInRange(body.difficulty, 1, 5, 3),
    exam_weight: numberInRange(body.exam_weight, 1, 5, 3),
    previous_frequency: numberInRange(body.previous_frequency, 0, 20, 0),
    class_emphasis: numberInRange(body.class_emphasis, 1, 5, 3),
    student_confidence: numberInRange(body.student_confidence, 1, 5, 2),
    status: body.status || "Revisar",
    review_count: Number(body.review_count || 0),
    correct_answers: Number(body.correct_answers || 0),
    total_answers: Number(body.total_answers || 0),
    last_reviewed_at: body.last_reviewed_at || null,
    next_review_at: body.next_review_at || today(),
    pdf_path: null,
    subtopics: toLines(body.subtopics),
    videos: toLines(body.videos),
    links: toLines(body.links),
    notes: String(body.notes || ""),
    questions,
    created_at: body.created_at || new Date().toISOString()
  };
}

function syncChallenge(store, subject, topic) {
  const question = (topic.questions || [])[0] || generateQuestions(topic.title, topic.summary)[0];
  let challenge = store.challenges.find((item) => item.topic_id === topic.id);
  if (!challenge) {
    challenge = { id: nextId(store), attempts: 0, score: 0, last_answer: "", feedback: "", locked_until: null, created_at: new Date().toISOString() };
    store.challenges.unshift(challenge);
  }
  Object.assign(challenge, {
    topic_id: topic.id,
    subject_id: subject.id,
    subject_name: subject.name,
    topic_title: topic.title,
    summary: topic.summary,
    questions: topic.questions,
    type: "Pergunta",
    prompt: question.question,
    reference_answer: question.answer || topic.summary,
    difficulty: topic.difficulty >= 4 ? "Dificil" : topic.difficulty === 3 ? "Medio" : "Facil",
    status: challenge.status || "Pendente",
    due_at: challenge.due_at || nextDate(1)
  });
}

async function loadStore() {
  const key = localKey();
  const local = parseJson(safeStorageGet(key, ""), null);
  if (!accessToken) return normalizeStore(local);

  try {
    const file = await findDriveFile();
    if (!file) {
      const fresh = normalizeStore(local);
      await writeDriveFile(fresh);
      return fresh;
    }
    const driveData = await readDriveFile(file.id);
    const store = normalizeStore(driveData || local);
    safeStorageSet(key, JSON.stringify(store));
    return store;
  } catch {
    return normalizeStore(local);
  }
}

async function saveStore(store) {
  const normalized = normalizeStore(store);
  normalized.updatedAt = new Date().toISOString();
  safeStorageSet(localKey(), JSON.stringify(normalized));
  if (accessToken) {
    try {
      const file = await findDriveFile();
      await writeDriveFile(normalized, file?.id);
      driveStatus = { mode: "drive", connected: true, message: "Dados sincronizados no Google Drive do aluno." };
    } catch (error) {
      driveStatus = { mode: "local", connected: false, message: error.message || "Falha ao salvar no Drive; mantido localmente." };
    }
  }
  return normalized;
}

async function findDriveFile() {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    q: `name='${DATA_FILE_NAME}' and trashed=false`
  });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  const data = await response.json();
  return data.files?.[0] || null;
}

async function readDriveFile(fileId) {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return response.json();
}

async function writeDriveFile(store, fileId = null) {
  if (fileId) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(store)
    });
    return;
  }

  const boundary = `prepara_${Date.now()}`;
  const metadata = { name: DATA_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(store),
    `--${boundary}--`
  ].join("\r\n");

  await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
}

async function driveFetch(url, options = {}) {
  await ensureDriveToken(false);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await nativeFetchRef(url, { ...options, headers });
  if (response.status === 401) {
    accessToken = "";
    await ensureDriveToken(true);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return nativeFetchRef(url, { ...options, headers });
  }
  if (!response.ok) throw new Error("Não foi possível acessar o Google Drive do aluno.");
  return response;
}

async function readBody(init) {
  const body = init.body;
  if (!body) return {};
  if (body instanceof FormData) return Object.fromEntries(body.entries());
  if (typeof body === "string") return parseJson(body, {});
  return body;
}

function normalizeStore(store) {
  const safe = store && typeof store === "object" ? store : {};
  return {
    version: 1,
    updatedAt: safe.updatedAt || new Date().toISOString(),
    nextId: Number(safe.nextId || 1),
    subjects: Array.isArray(safe.subjects) ? safe.subjects.map(normalizeSubject) : [],
    predictions: Array.isArray(safe.predictions) ? safe.predictions : [],
    challenges: Array.isArray(safe.challenges) ? safe.challenges : [],
    studySessions: Array.isArray(safe.studySessions) ? safe.studySessions : [],
    examAttempts: Array.isArray(safe.examAttempts) ? safe.examAttempts : []
  };
}

function normalizeSubject(subject) {
  return { ...subject, topics: Array.isArray(subject.topics) ? subject.topics : [] };
}

function buildDashboard(store) {
  const topics = allTopics(store);
  const challenges = joinedChallenges(store);
  const totalAnswers = topics.reduce((sum, topic) => sum + (topic.total_answers || 0), 0);
  const correctAnswers = topics.reduce((sum, topic) => sum + (topic.correct_answers || 0), 0);
  const totalMinutes = store.studySessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const dominated = topics.filter((topic) => topic.status === "Dominado").length;
  const repeat = topics.filter((topic) => topic.status === "Repetir").length;
  const review = topics.filter((topic) => topic.status === "Revisar").length;
  const completedChallenges = challenges.filter((item) => item.status === "Concluido").length;
  return {
    totalMinutes,
    subjectCount: store.subjects.length,
    accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
    pendingChallenges: challenges.filter((item) => item.status !== "Concluido").length,
    ranking: Math.max(1, Math.min(30, store.studySessions.length || 1)),
    level: Math.max(1, Math.floor((totalMinutes * 2 + completedChallenges * 50) / 250) + 1),
    xp: totalMinutes * 2 + completedChallenges * 50,
    distribution: { dominated, review, repeat, critical: topics.filter((topic) => (topic.student_confidence || 0) <= 2).length },
    nextExams: store.subjects.filter((item) => item.exam_date).slice(0, 5),
    achievements: [
      { title: "Primeira Matéria", detail: "Cadastre uma matéria", earned: store.subjects.length > 0 },
      { title: "Treinador de Desafios", detail: "Conclua 3 desafios", earned: completedChallenges >= 3 },
      { title: "Especialista em Simulados", detail: "Conclua 5 desafios", earned: completedChallenges >= 5 }
    ],
    risk: repeat
  };
}

function buildReport(store) {
  const dashboard = buildDashboard(store);
  const topics = allTopics(store);
  return {
    totalMinutes: dashboard.totalMinutes,
    accuracy: dashboard.accuracy,
    totalTopics: topics.length,
    dominated: topics.filter((topic) => topic.status === "Dominado").length,
    weakestTopics: topics.slice().sort((a, b) => weaknessScore(b) - weaknessScore(a)).slice(0, 5)
  };
}

function allTopics(store) {
  return store.subjects.flatMap((subject) => subject.topics.map((topic) => enrichTopic(subject, topic)));
}

function enrichTopic(subject, topic) {
  return {
    ...topic,
    subject_name: subject.name,
    subjectName: subject.name,
    subject_weight: subject.weight || 3,
    probability: predictionScore(topic)
  };
}

function joinedChallenges(store) {
  return store.challenges.map((challenge) => {
    const found = findTopic(store, challenge.topic_id);
    return {
      ...challenge,
      subject_name: found?.subject.name || challenge.subject_name || "",
      topic_title: found?.topic.title || challenge.topic_title || "",
      reference_answer: challenge.reference_answer || found?.topic.summary || ""
    };
  });
}

function buildQuizPlan(topics) {
  const items = [];
  for (const topic of topics.filter((item) => Array.isArray(item.questions) && item.questions.length > 0)) {
    for (const [questionIndex, question] of topic.questions.entries()) {
      const options = makeMultipleChoiceOptions(question.answer, topic.title);
      items.push({
        id: `${topic.id}-${questionIndex}`,
        topic_id: topic.id,
        question_index: questionIndex,
        title: topic.title,
        subject_name: topic.subject_name,
        question: question.question,
        hint: topic.notes || topic.summary || "Responda com suas palavras.",
        correct_answer: question.answer,
        correct_index: 0,
        options: options.map((option, index) => ({ id: index, label: String.fromCharCode(65 + index), text: option.text })),
        status: topic.status
      });
      if (items.length >= 7) return items;
    }
  }
  return items;
}

function buildExam(store, count) {
  const topics = allTopics(store);
  const questions = topics.flatMap((topic) => (topic.questions || generateQuestions(topic.title, topic.summary)).map((question) => ({
    topic_id: topic.id,
    subject: topic.subject_name,
    topic: topic.title,
    difficulty: topic.difficulty >= 4 ? "Difícil" : topic.difficulty === 3 ? "Médio" : "Fácil",
    question: question.question,
    expected_answer: question.answer
  }))).slice(0, count);
  return { count: questions.length, questions };
}

function buildChallengeQuizQuestions(challenge) {
  if (!challenge) return [];
  const questions = (challenge.questions?.length ? challenge.questions : generateQuestions(challenge.topic_title, challenge.summary)).slice(0, 5);
  return questions.map((item) => {
    const options = makeMultipleChoiceOptions(item.answer || challenge.reference_answer, challenge.topic_title);
    return { question: item.question, options, explanation: item.answer || challenge.reference_answer, correctIndex: 0 };
  });
}

function makeMultipleChoiceOptions(correctAnswer, topicTitle) {
  return [
    { text: correctAnswer || `A resposta correta explica ${topicTitle}.` },
    { text: `Uma definição incompleta de ${topicTitle}.` },
    { text: "Uma resposta fora do foco da pergunta." },
    { text: "Uma alternativa superficial, sem aplicação prática." }
  ];
}

function evaluateAnswer(challenge, answer) {
  const reference = [challenge.reference_answer, challenge.summary, ...(challenge.questions || []).map((item) => item.answer)].filter(Boolean).join(" ");
  const answerTokens = importantTokens(answer);
  const referenceTokens = new Set(importantTokens(reference));
  const matched = answerTokens.filter((token) => referenceTokens.has(token));
  const exact = normalize(answer) === normalize(challenge.reference_answer || "");
  const score = exact ? 100 : Math.min(100, Math.round((new Set(matched).size / Math.max(1, Math.min(answerTokens.length, 24))) * 100));
  const correct = score > 50;
  return {
    correct,
    score,
    level: score >= 80 ? "Excelente" : score > 50 ? "Bom caminho" : "Precisa revisar",
    feedback: correct ? `Resposta correta. Você atingiu ${score}%.` : `Ainda não validou. Você atingiu ${score}%. Inclua mais termos da resposta-base.`,
    guidance: correct ? "Continue usando conceito, explicação e exemplo." : "Releia a resposta-base e responda com frases completas.",
    matchedTerms: [...new Set(matched)].slice(0, 8),
    missingTerms: [...referenceTokens].filter((token) => !answerTokens.includes(token)).slice(0, 6)
  };
}

function generateQuestions(title, summary = "") {
  const answer = summary || `Conceitos essenciais de ${title}.`;
  return [
    { question: `Qual é a ideia central de ${title}?`, answer },
    { question: `Como ${title} pode aparecer em uma questão discursiva?`, answer: `Explique o conceito, cite um exemplo e conecte com um problema real.` },
    { question: `Que detalhe diferencia uma boa resposta sobre ${title}?`, answer: `Usar termos corretos e justificar a aplicação no contexto da prova.` }
  ];
}

function normalizeQuestions(value, title, summary) {
  if (Array.isArray(value)) return value.length ? value : generateQuestions(title, summary);
  const lines = toLines(value);
  if (!lines.length) return generateQuestions(title, summary);
  return lines.map((line) => ({ question: line, answer: summary || line }));
}

function findTopic(store, topicId) {
  for (const subject of store.subjects) {
    const topic = subject.topics.find((item) => item.id === topicId);
    if (topic) return { subject, topic };
  }
  return null;
}

function findChallenge(store, challengeId) {
  return store.challenges.find((item) => item.id === challengeId) || null;
}

function nextId(store) {
  const id = Number(store.nextId || 1);
  store.nextId = id + 1;
  return id;
}

function localKey() {
  const raw = activeProfile?.googleSub || activeProfile?.email || activeProfile?.name || safeStorageGet("prepara:user", "default");
  return `${LOCAL_PREFIX}${normalize(raw) || "default"}`;
}

function predictionScore(topic) {
  const accuracyPenalty = topic.total_answers > 0 ? 1 - topic.correct_answers / topic.total_answers : 0.4;
  return Math.max(15, Math.min(95, Math.round(25 + (topic.exam_weight || 3) * 5 + (topic.class_emphasis || 3) * 4 + (topic.difficulty || 3) * 3 + accuracyPenalty * 10 - (topic.student_confidence || 2) * 3)));
}

function weaknessScore(topic) {
  const accuracy = topic.total_answers > 0 ? topic.correct_answers / topic.total_answers : 0.5;
  return Math.round((1 - accuracy) * 45 + (topic.difficulty || 3) * 8 + (6 - (topic.student_confidence || 2)) * 6);
}

function importantTokens(text) {
  const ignored = new Set(["para", "como", "com", "uma", "que", "por", "dos", "das", "nas", "nos", "seu", "sua", "tema", "este", "esta", "isso", "mais", "muito"]);
  return normalize(text).split(" ").filter((token) => token.length >= 4 && !ignored.has(token));
}

function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function numberInRange(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function toLines(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function safeStorageGet(key, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage may be blocked.
  }
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  connectStudentDrive,
  installStudentDriveApi,
  setStudentDriveProfile
} from "./student-drive-api.js";
import {
  Award,
  Bell,
  BookOpen,
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Edit3,
  Flame,
  GraduationCap,
  LayoutDashboard,
  Link as LinkIcon,
  ListChecks,
  LogOut,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Sparkles,
  Star,
  Target,
  Trophy,
  Trash2,
  Upload,
  UserRound,
  Zap
} from "lucide-react";
import "./styles.css";

installStudentDriveApi();

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "subjects", label: "Matérias", icon: BookOpen },
  { id: "contents", label: "Conteúdos", icon: ListChecks },
  { id: "quiz", label: "Quiz", icon: CalendarClock },
  { id: "challenges", label: "Desafios", icon: Star },
  { id: "exam", label: "Simulados", icon: ClipboardList },
  { id: "predictions", label: "Previsão de Prova", icon: Target },
  { id: "achievements", label: "Conquistas", icon: Trophy }
];

function safeStorageGet(key, fallback = "") {
  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore write errors (private mode / blocked storage)
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore remove errors
  }
}

function App() {
  const [userProfile, setUserProfile] = useState(() => getStoredProfile());
  const [user, setUser] = useState(() => {
    const profile = getStoredProfile();
    return profile?.name || safeStorageGet("prepara:user", "") || "";
  });
  const [active, setActive] = useState("dashboard");
  const [subjects, setSubjects] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [quizItems, setQuizItems] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);

  const topics = useMemo(() => subjects.flatMap((subject) => subject.topics.map((topic) => ({
    ...topic,
    subjectName: subject.name,
    examDate: subject.exam_date
  }))), [subjects]);

  useEffect(() => {
    if (!user) return undefined;
    let canceled = false;
    const profile = getStoredProfile();
    setStudentDriveProfile(profile, import.meta.env.VITE_GOOGLE_CLIENT_ID);
    connectStudentDrive(profile, import.meta.env.VITE_GOOGLE_CLIENT_ID, false)
      .finally(() => {
        if (!canceled) refresh();
      });
    return () => {
      canceled = true;
    };
  }, [user]);

  async function refresh(showNotice = false) {
    try {
      setLoading(true);
      const [dashboardRes, subjectsRes, quizRes, predictionsRes, challengesRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/subjects"),
        fetch("/api/quiz"),
        fetch("/api/predictions"),
        fetch("/api/challenges")
      ]);
      const responses = [dashboardRes, subjectsRes, quizRes, predictionsRes, challengesRes];
      if (responses.some((response) => !response.ok)) throw new Error("Não foi possível carregar o sistema.");
      setDashboard(await dashboardRes.json());
      setSubjects(await subjectsRes.json());
      setQuizItems(await quizRes.json());
      setPredictions(await predictionsRes.json());
      setChallenges(await challengesRes.json());
      if (showNotice) notify("Dados atualizados.");
    } catch (error) {
      notify(error.message || "Erro ao carregar dados.", "error");
    } finally {
      setLoading(false);
    }
  }

  function notify(message, type = "success") {
    setNotice({ message, type, id: Date.now() });
  }

  async function handleLogin(payload) {
    const profile = normalizeLoginPayload(payload);
    if (!profile.name) return;
    const identityKey = profile.googleSub || profile.email || profile.name;
    safeStorageSet("prepara:user", identityKey);
    safeStorageSet("prepara:userProfile", JSON.stringify(profile));
    setStudentDriveProfile(profile, import.meta.env.VITE_GOOGLE_CLIENT_ID);
    setUser(profile.name);
    setUserProfile(profile);
    if (profile.provider === "google") {
      const status = await connectStudentDrive(profile, import.meta.env.VITE_GOOGLE_CLIENT_ID, true);
      notify(status.connected ? "Dados conectados ao Google Drive do aluno." : status.message, status.connected ? "success" : "warning");
    }
  }

  function handleLogout() {
    if (window.google?.accounts?.id?.disableAutoSelect) {
      window.google.accounts.id.disableAutoSelect();
    }
    safeStorageRemove("prepara:user");
    safeStorageRemove("prepara:userProfile");
    setUser("");
    setUserProfile(null);
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="appShell">
      <Sidebar
        user={user}
        userProfile={userProfile}
        active={active}
        setActive={setActive}
        onLogout={handleLogout}
        dashboard={dashboard}
      />
      <main className="content">
        <Header user={user} active={active} loading={loading} onRefresh={() => refresh(true)} />
        <Notice notice={notice} onClose={() => setNotice(null)} />

        {active === "dashboard" && (
          <Dashboard
            dashboard={dashboard}
            quizItems={quizItems}
            predictions={predictions}
            challenges={challenges}
            topics={topics}
            goTo={setActive}
            notify={notify}
            refresh={refresh}
          />
        )}
        {active === "subjects" && <SubjectsView subjects={subjects} notify={notify} refresh={refresh} goTo={setActive} />}
        {active === "contents" && <ContentsView subjects={subjects} notify={notify} refresh={refresh} goTo={setActive} />}
        {active === "quiz" && <QuizView quizItems={quizItems} notify={notify} refresh={refresh} />}
        {active === "challenges" && <ChallengesView challenges={challenges} notify={notify} refresh={refresh} />}
        {active === "exam" && <ExamView topics={topics} notify={notify} refresh={refresh} goTo={setActive} />}
        {active === "predictions" && <PredictionsView predictions={predictions} refresh={refresh} notify={notify} />}
        {active === "achievements" && <AchievementsView dashboard={dashboard} />}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [name, setName] = useState("");
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const googleButtonRef = useRef(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return undefined;
    setGoogleLoading(true);
    setGoogleError("");

    let canceled = false;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (canceled || !window.google?.accounts?.id) return;
      try {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            const profile = decodeGoogleCredential(response.credential);
            if (!profile?.name) {
              setGoogleError("Não foi possível ler os dados do Google.");
              return;
            }
            onLogin({
              name: profile.name,
              email: profile.email || "",
              picture: profile.picture || "",
              googleSub: profile.googleSub || "",
              provider: "google"
            });
          }
        });
        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          locale: "pt-BR",
          width: 260
        });
      } catch {
        setGoogleError("Não foi possível iniciar o login com Google.");
      } finally {
        setGoogleLoading(false);
      }
    };

    script.onerror = () => {
      if (!canceled) {
        setGoogleError("Falha ao carregar login Google.");
        setGoogleLoading(false);
      }
    };

    document.head.appendChild(script);
    return () => {
      canceled = true;
    };
  }, [googleClientId, onLogin]);

  function submit(event) {
    event.preventDefault();
    if (name.trim()) onLogin({ name: name.trim(), provider: "manual" });
  }

  return (
    <main className="loginScreen">
      <section className="loginPanel">
        <div className="loginBrand">
          <div className="loginMark"><Brain size={34} /></div>
          <div>
            <h1>Prepara Prova IA</h1>
            <p>Não basta estudar. É preciso compreender, escrever, praticar e evoluir.</p>
          </div>
        </div>
        <form onSubmit={submit} className="loginForm">
          <label>Acessar com Google (Gmail)</label>
          <small className="loginHint">Cada aluno entra com sua conta Gmail e acessa apenas os próprios dados.</small>
          {googleClientId ? (
            <div className="googleLoginBox">
              <div ref={googleButtonRef} />
              {googleLoading && <small>Preparando login Google...</small>}
              {googleError && <small className="loginError">{googleError}</small>}
            </div>
          ) : (
            <small className="loginHint">Configure `VITE_GOOGLE_CLIENT_ID` no .env para habilitar o login Google.</small>
          )}

          <div className="loginDivider"><span>ou</span></div>

          <label htmlFor="student">Nome do aluno</label>
          <input id="student" value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" />
          <button className="primaryButton" type="submit">
            <CheckCircle2 size={18} />
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}

function Sidebar({ user, userProfile, active, setActive, onLogout, dashboard }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><Brain size={25} /></div>
        <div>
          <strong>Prepara<br />Prova IA</strong>
          <span>Seu treinador para aprovação · com desafios IA</span>
        </div>
      </div>

      <nav className="navList" aria-label="Navegação principal">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              className={active === item.id ? "navItem active" : "navItem"}
              key={item.id}
              onClick={() => setActive(item.id)}
              title={item.label}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <button className="profileBox" type="button" onClick={() => setActive("dashboard")}>
        <div className="avatar">{user.slice(0, 1).toUpperCase()}</div>
        <div>
          <strong>{user}</strong>
          {userProfile?.email && <span>{userProfile.email}</span>}
          <span>Nível {dashboard?.level || 1}</span>
          <small>XP {dashboard?.xp || 0}</small>
        </div>
      </button>

      <div className="streakBox">
        <span>Sequência de estudos</span>
        <strong><Flame size={22} /> {dashboard?.ranking || 1} dias</strong>
        <small>Você está mandando bem!</small>
      </div>

      <button className="logoutButton" type="button" onClick={onLogout}>
        <LogOut size={18} />
        Sair
      </button>
    </aside>
  );
}

function Header({ user, active, loading, onRefresh }) {
  const current = navItems.find((item) => item.id === active);
  return (
    <header className="topbar">
      <div>
        <h2>Olá, {user}! <span>👋</span></h2>
        <p>{current?.label || "Dashboard"} · Continue firme! Cada passo te aproxima da aprovação.</p>
      </div>
      <div className="topActions">
        <label className="searchBox">
          <Search size={18} />
          <input placeholder="Buscar conteúdos, desafios..." />
        </label>
        <button className="iconButton" type="button" onClick={onRefresh} aria-busy={loading} title="Atualizar">
          <RefreshCcw size={18} />
        </button>
        <button className="iconButton notifyButton" type="button" title="Notificações">
          <Bell size={18} />
          <span>3</span>
        </button>
      </div>
    </header>
  );
}

function Notice({ notice, onClose }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);
  if (!notice) return null;
  return (
    <div className={`notice ${notice.type}`} role="status">
      <span>{notice.message}</span>
      <button type="button" onClick={onClose}>OK</button>
    </div>
  );
}

function Dashboard({ dashboard, quizItems, predictions, challenges, topics, goTo, notify, refresh }) {
  const today = quizItems || [];
  const pending = challenges.filter((item) => item.status !== "Concluido").slice(0, 3);

  async function startStudy(topic) {
    await fetch("/api/study-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic_id: topic.id, minutes: 30 })
    });
    notify(`${topic.title}: sessão de revisão registrada.`);
    await refresh();
  }

  return (
    <section className="screenStack">
      <div className="metricGrid">
        <Metric icon={CalendarClock} label="Horas estudadas" value={formatHours(dashboard?.totalMinutes || 0)} hint="+ registre seus estudos" tone="purple" />
        <Metric icon={BookOpen} label="Matérias ativas" value={dashboard?.subjectCount || 0} hint={`Temas: ${topics.length}`} tone="blue" />
        <Metric icon={Target} label="Taxa de aproveitamento" value={`${dashboard?.accuracy || 0}%`} hint="simulados, desafios e quizzes" tone="green" />
        <Metric icon={Flame} label="Desafios pendentes" value={dashboard?.pendingChallenges || 0} hint="continue assim" tone="orange" />
      </div>

      {topics.length === 0 && (
        <section className="emptyHero">
          <div>
            <h3>Comece cadastrando sua primeira matéria</h3>
            <p>Depois disso o sistema libera conteúdos, ciclo automático, desafios, simulados e previsão de prova.</p>
          </div>
          <button className="primaryButton" type="button" onClick={() => goTo("subjects")}>
            <Plus size={18} />
            Cadastrar matéria
          </button>
        </section>
      )}

      <div className="dashboardLayout">
        <section className="panel studyPanel">
          <PanelTitle title="Quiz de Revisão - Hoje" action="20 de Maio" />
          <div className="planList">
            {today.length === 0 && <EmptyState text="Nenhum tema preparado para quiz ainda." />}
            {today.map((topic) => (
              <article className="planRow" key={topic.id}>
                <div className="planIcon"><LinkIcon size={18} /></div>
                <div>
                  <strong>{topic.title}</strong>
                  <span>{topic.subject_name || topic.subjectName || "Conteúdo"}</span>
                </div>
                <small>{topic.question}</small>
                <button type="button" className="roundAction" onClick={() => goTo("quiz")} title="Ir para quiz">
                  <Play size={14} />
                </button>
              </article>
            ))}
          </div>
          <button className="primaryButton full" type="button" onClick={() => goTo("quiz")}>
            <Play size={16} />
            Começar o quiz
          </button>
        </section>

        <section className="panel">
          <PanelTitle title="Previsão de Prova" action="Ver todas" onAction={() => goTo("predictions")} />
          <div className="predictionBars">
            {predictions.slice(0, 7).map((item) => <ExamPlanCard item={item} key={item.id} />)}
            {predictions.length === 0 && <EmptyState text="Cadastre provas com data, professor e nota necessária." />}
          </div>
        </section>

        <aside className="sideStack">
          <section className="panel compactPanel">
            <PanelTitle title="Próximas Provas" action="Ver todas" onAction={() => goTo("subjects")} />
            <div className="examList">
              {(dashboard?.nextExams || []).map((subject) => (
                <div className="examRow" key={subject.id}>
                  <div>
                    <strong>{subject.name}</strong>
                    <span>{subject.exam_date || "Sem data"}</span>
                  </div>
                  <b>{daysUntil(subject.exam_date)} dias</b>
                </div>
              ))}
              {(dashboard?.nextExams || []).length === 0 && <EmptyState text="Sem provas cadastradas." />}
            </div>
          </section>
        </aside>
      </div>

      <div className="dashboardLayout bottom">
        <section className="panel">
          <PanelTitle title="Desafios Pendentes" action="Ver todos" onAction={() => goTo("challenges")} />
          <div className="challengeList">
            {pending.map((challenge) => (
              <article className="challengeRow" key={challenge.id}>
                <div className="challengeIcon"><Edit3 size={17} /></div>
                <div>
                  <strong>{challenge.prompt}</strong>
                  <span>{challenge.type}</span>
                </div>
                <span className="tag">{challenge.difficulty}</span>
                <ChevronRight size={18} />
              </article>
            ))}
            {pending.length === 0 && <EmptyState text="Nenhum desafio pendente." />}
          </div>
        </section>

        <section className="panel performancePanel">
          <PanelTitle title="Desempenho Geral" />
          <div className="performanceBody">
            <div className="donut" style={{ "--value": `${dashboard?.accuracy || 0}%` }}>
              <strong>{dashboard?.accuracy || 0}%</strong>
              <span>Aproveitamento</span>
            </div>
            <div className="legend">
              <Legend color="green" label="Dominado" value={dashboard?.distribution?.dominated || 0} />
              <Legend color="yellow" label="Em revisão" value={dashboard?.distribution?.review || 0} />
              <Legend color="orange" label="Em risco" value={dashboard?.distribution?.risk || 0} />
              <Legend color="red" label="Crítico" value={dashboard?.distribution?.critical || 0} />
            </div>
          </div>
          <p className="smallPraise"><Star size={16} /> Você está indo muito bem. Continue assim!</p>
        </section>
      </div>

      <div className="wideFooter">
        <section className="darkPanel achievementsStrip">
          <PanelTitle title="Conquistas Recentes" action="Ver todas" onAction={() => goTo("achievements")} />
          <div className="badgeGrid">
            {(dashboard?.achievements || []).map((item) => <BadgeCard item={item} key={item.title} />)}
          </div>
        </section>
        <section className="quotePanel">
          <GraduationCap size={58} />
          <strong>“Disciplina hoje, aprovação amanhã!”</strong>
          <span>Seu futuro começa nas escolhas que você faz agora.</span>
        </section>
      </div>
    </section>
  );
}

function SubjectsView({ subjects, notify, refresh, goTo }) {
  const [form, setForm] = useState({ name: "", professor: "", exam_date: "", weight: 3, difficulty: 3, desired_hours: 6 });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      const response = await fetch(editingId ? `/api/subjects/${editingId}` : "/api/subjects", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error("Não foi possível salvar a matéria.");
      setForm({ name: "", professor: "", exam_date: "", weight: 3, difficulty: 3, desired_hours: 6 });
      setEditingId(null);
      await refresh();
      notify(editingId ? "Matéria atualizada." : "Matéria salva. Agora cadastre conteúdos.");
      if (!editingId) goTo("contents");
    } catch (error) {
      notify(error.message || "Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  function editSubject(subject) {
    setEditingId(subject.id);
    setForm({
      name: subject.name || "",
      professor: subject.professor || "",
      exam_date: subject.exam_date || "",
      weight: subject.weight || 3,
      difficulty: subject.difficulty || 3,
      desired_hours: subject.desired_hours || 6
    });
  }

  async function deleteSubject(subject) {
    if (!window.confirm(`Excluir a matéria "${subject.name}" e todos os conteúdos dela?`)) return;
    const response = await fetch(`/api/subjects/${subject.id}`, { method: "DELETE" });
    if (!response.ok) {
      notify("Não foi possível excluir a matéria.", "error");
      return;
    }
    if (editingId === subject.id) {
      setEditingId(null);
      setForm({ name: "", professor: "", exam_date: "", weight: 3, difficulty: 3, desired_hours: 6 });
    }
    await refresh();
    notify("Matéria excluída.");
  }

  return (
    <section className="splitView">
      <form className="panel dataForm" onSubmit={submit}>
        <PanelTitle title={editingId ? "Editar Matéria" : "Cadastrar Matéria"} />
        <Field label="Nome da matéria"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Engenharia de Software" required /></Field>
        <Field label="Professor"><input value={form.professor} onChange={(event) => setForm({ ...form, professor: event.target.value })} placeholder="Nome do professor" /></Field>
        <div className="formGrid">
          <Field label="Data da prova"><input type="date" value={form.exam_date} onChange={(event) => setForm({ ...form, exam_date: event.target.value })} /></Field>
          <Field label="Carga horária semanal"><input type="number" min="1" max="40" value={form.desired_hours} onChange={(event) => setForm({ ...form, desired_hours: event.target.value })} /></Field>
          <Field label="Peso da matéria"><Range value={form.weight} min="1" max="5" onChange={(value) => setForm({ ...form, weight: value })} /></Field>
          <Field label="Grau de dificuldade"><Range value={form.difficulty} min="1" max="5" onChange={(value) => setForm({ ...form, difficulty: value })} /></Field>
        </div>
        <div className="buttonRow">
          <button className="primaryButton fit" type="submit" disabled={saving}><Save size={18} />{saving ? "Salvando..." : editingId ? "Atualizar matéria" : "Salvar matéria"}</button>
          {editingId && <button className="secondaryButton fit" type="button" onClick={() => { setEditingId(null); setForm({ name: "", professor: "", exam_date: "", weight: 3, difficulty: 3, desired_hours: 6 }); }}>Cancelar</button>}
        </div>
      </form>

      <section className="panel">
        <PanelTitle title="Matérias Cadastradas" />
        <div className="subjectList">
          {subjects.map((subject) => (
            <article className="subjectRow" key={subject.id}>
              <BookOpen size={20} />
              <div>
                <strong>{subject.name}</strong>
                <span>{subject.professor || "Professor não informado"} · {subject.topics.length} temas</span>
              </div>
              <b>{subject.desired_hours || 0}h/sem</b>
              <div className="rowActions">
                <button type="button" onClick={() => editSubject(subject)} title="Editar matéria"><Edit3 size={16} /></button>
                <button type="button" onClick={() => deleteSubject(subject)} title="Excluir matéria"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {subjects.length === 0 && <EmptyState text="Nenhuma matéria cadastrada." />}
        </div>
      </section>
    </section>
  );
}


function ContentsView({ subjects, notify, refresh, goTo }) {
  const firstSubject = subjects[0]?.id || "";
  const [form, setForm] = useState({
    subject_id: firstSubject,
    title: "",
    question: "",
    answer: ""
  });
  const [classContent, setClassContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const topics = subjects.flatMap((subject) => subject.topics.map((topic) => ({ ...topic, subjectName: subject.name })));

  useEffect(() => {
    if (!form.subject_id && firstSubject) setForm((current) => ({ ...current, subject_id: firstSubject }));
  }, [firstSubject, form.subject_id]);

  if (subjects.length === 0) {
    return <EmptyAction title="Cadastre uma matéria primeiro" text="Depois você poderá adicionar tema, pergunta e resposta-base." action="Cadastrar matéria" onClick={() => goTo("subjects")} />;
  }

  async function generateWithAi() {
    const response = await fetch("/api/ai-helper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: form.title || "Tema", content: classContent })
    });
    const data = await response.json();
    setForm((current) => ({
      ...current,
      answer: data.summary,
      question: data.questions[0]?.question || `Explique ${current.title || "o tema"} com suas palavras.`
    }));
    notify("Pergunta e resposta geradas.");
  }

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        payload.append(key, value ?? "");
      });
      const response = editingId
        ? await fetch(`/api/topics/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        })
        : await fetch("/api/topics", { method: "POST", body: payload });
      if (!response.ok) throw new Error("Não foi possível salvar o conteúdo.");
      setForm((current) => ({ ...current, title: "", question: "", answer: "" }));
      setEditingId(null);
      setClassContent("");
      await refresh();
      notify(editingId ? "Conteúdo atualizado." : "Conteúdo salvo. Desafio criado automaticamente.");
      if (!editingId) goTo("challenges");
    } catch (error) {
      notify(error.message || "Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  function editTopic(topic) {
    const firstQuestion = topic.questions?.[0] || {};
    setEditingId(topic.id);
    setForm({
      subject_id: topic.subject_id,
      title: topic.title || "",
      question: firstQuestion.question || `Explique ${topic.title || "o tema"} com suas palavras.`,
      answer: firstQuestion.answer || topic.summary || ""
    });
  }

  async function deleteTopic(topic) {
    if (!window.confirm(`Excluir o conteúdo "${topic.title}"?`)) return;
    const response = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
    if (!response.ok) {
      notify("Não foi possível excluir o conteúdo.", "error");
      return;
    }
    if (editingId === topic.id) {
      setEditingId(null);
      setForm((current) => ({ ...current, title: "", question: "", answer: "" }));
    }
    await refresh();
    notify("Conteúdo excluído.");
  }

  return (
    <section className="topicFormLayout">
      <form className="panel dataForm wide" onSubmit={submit}>
        <PanelTitle title={editingId ? "Editar Conteúdo" : "Cadastrar Conteúdo"} />
        <Field label="Matéria">
          <select value={form.subject_id} onChange={(event) => setForm({ ...form, subject_id: event.target.value })}>
            {subjects.map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}
          </select>
        </Field>
        <Field label="Tema"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Scrum" required /></Field>
        <Field label="Pergunta"><textarea value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} rows="3" placeholder="Explique Scrum com suas palavras." required /></Field>
        <Field label="Resposta"><textarea value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} rows="7" placeholder="Resposta-base que o sistema usara para comparar no desafio." required /></Field>
        <div className="buttonRow">
          <button className="primaryButton fit" type="submit" disabled={saving}><Save size={18} />{saving ? "Salvando..." : editingId ? "Atualizar conteúdo" : "Salvar conteúdo"}</button>
          {editingId && <button className="secondaryButton fit" type="button" onClick={() => { setEditingId(null); setForm((current) => ({ ...current, title: "", question: "", answer: "" })); }}>Cancelar</button>}
        </div>
      </form>

      <aside className="panel aiPanel">
        <PanelTitle title="Conteúdos Cadastrados" />
        <div className="manageList">
          {topics.map((topic) => (
            <article className="manageRow" key={topic.id}>
              <div>
                <strong>{topic.title}</strong>
                <span>{topic.subjectName}</span>
              </div>
              <div className="rowActions">
                <button type="button" onClick={() => editTopic(topic)} title="Editar conteúdo"><Edit3 size={16} /></button>
                <button type="button" onClick={() => deleteTopic(topic)} title="Excluir conteúdo"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {topics.length === 0 && <EmptyState text="Nenhum conteúdo cadastrado." />}
        </div>
      </aside>
    </section>
  );
}

function QuizView({ quizItems, notify, refresh }) {
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedTopic = quizItems.find((item) => item.id === selectedTopicId) || quizItems[0] || null;

  useEffect(() => {
    if (!selectedTopicId && quizItems.length > 0) {
      setSelectedTopicId(quizItems[0].id);
      setSelectedOptionId(null);
      setResult(null);
    }
  }, [quizItems, selectedTopicId]);

  async function submitQuiz(event) {
    event.preventDefault();
    if (!selectedTopic) return;
    if (selectedOptionId === null) {
      notify("Selecione uma alternativa antes de enviar.", "error");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const selectedOption = selectedTopic.options.find((option) => option.id === selectedOptionId);
      if (!selectedOption) {
        notify("Alternativa inválida.", "error");
        return;
      }
      const response = await fetch(`/api/quiz/${selectedTopic.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: selectedOption.text })
      });
      const data = await response.json();
      if (!response.ok) {
        notify(data.error || "Não foi possível enviar sua resposta.", "error");
        return;
      }
      setResult(data);
      setSelectedOptionId(null);
      notify(data.correct ? "Correto! Sua revisão foi registrada." : "Resposta incorreta. Reveja e tente novamente.", data.correct ? "success" : "warning");
      await refresh();
    } catch (error) {
      notify(error.message || "Erro ao enviar o quiz.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (quizItems.length === 0) {
    return <EmptyAction title="Sem quiz disponível" text="Adicione temas e perguntas para revisar o que você escreveu." />;
  }

  return (
    <section className="screenStack">
      <article className="panel">
        <PanelTitle title="Quiz de Revisão" action="Responda para reforçar" />
        <div className="quizLayout">
          <div className="quizTopics">
            {quizItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selectedTopic?.id === item.id ? "active quizTopicButton" : "quizTopicButton"}
                onClick={() => setSelectedTopicId(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.subject_name || "Sem matéria"}</span>
              </button>
            ))}
          </div>
          <form className="quizForm" onSubmit={submitQuiz}>
            <PanelTitle title={selectedTopic.title} action={selectedTopic.subject_name || "Tema"} />
            <div className="quizQuestion">
              <p>{selectedTopic.question}</p>
              {selectedTopic.hint && <small>{selectedTopic.hint}</small>}
            </div>
            <Field label="Alternativas">
              <div className="quizOptions">
                {selectedTopic.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`quizOption ${selectedOptionId === option.id ? "selected" : ""}`}
                    onClick={() => setSelectedOptionId(option.id)}
                  >
                    <span>{option.label}</span>
                    <p>{option.text}</p>
                  </button>
                ))}
              </div>
            </Field>
            <div className="buttonRow">
              <button className="primaryButton fit" type="submit" disabled={submitting}>
                <CheckCircle2 size={18} />Enviar resposta
              </button>
              <button className="secondaryButton fit" type="button" onClick={() => setSelectedOptionId(null)}>
                Limpar
              </button>
            </div>
            {result && (
              <div className={`quizResult ${result.correct ? "success" : "error"}`}>
                <strong>{result.correct ? "Acerto!" : "Continue tentando"}</strong>
                <p>{result.feedback || (result.correct ? "Boa resposta!" : "Veja a explicação e tente novamente.")}</p>
                {result.score !== undefined && <small>Pontuação: {result.score}%</small>}
              </div>
            )}
          </form>
        </div>
      </article>
    </section>
  );
}

function ChallengesView({ challenges, notify, refresh }) {
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState({});
  const [visibleAnswers, setVisibleAnswers] = useState({});
  const [editing, setEditing] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [correctingId, setCorrectingId] = useState(null);
  const [quizState, setQuizState] = useState(null);
  const [quizSelectedOption, setQuizSelectedOption] = useState(null);
  const [quizResult, setQuizResult] = useState(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  const groupedChallenges = useMemo(() => {
    const groups = new Map();
    for (const challenge of challenges) {
      const subject = challenge.subject_name || "Sem matéria";
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push(challenge);
    }
    return [...groups.entries()].map(([subject, items]) => ({ subject, items }));
  }, [challenges]);

  useEffect(() => {
    fetch("/api/ai-professor/status")
      .then((response) => response.json())
      .then(setAiStatus)
      .catch(() => setAiStatus({ configured: false, mode: "IA local" }));
  }, []);

  async function submitAnswer(challenge) {
    const answer = answers[challenge.id] || "";
    try {
      setCorrectingId(challenge.id);
      const response = await fetch(`/api/challenges/${challenge.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer })
      });
      const data = await response.json();
      if (!response.ok) {
        setResults((current) => ({ ...current, [challenge.id]: data }));
        notify(data.error || "Não foi possível corrigir a resposta.", "error");
        return;
      }
      setResults((current) => ({ ...current, [challenge.id]: data }));
      if (data.correct) {
        setAnswers((current) => ({ ...current, [challenge.id]: "" }));
        notify(data.evaluator === "professor-ai" ? "Professor IA validou sua resposta." : "Resposta correta. Dashboard atualizado.");
      } else {
        notify("Professor IA pediu ajustes. Aguarde 3 minutos para tentar novamente.", "error");
      }
      await refresh();

      const quizResponse = await fetch(`/api/challenges/${challenge.id}/quiz`);
      if (quizResponse.ok) {
        const quizQuestions = await quizResponse.json();
        if (quizQuestions.length > 0) {
          setQuizState({ challengeId: challenge.id, topicTitle: challenge.topic_title, questions: quizQuestions, current: 0 });
          setQuizSelectedOption(null);
          setQuizResult(null);
          notify("Quiz rápido iniciado! Responda 5 questões de múltipla escolha para reforçar o conteúdo.");
        }
      }
    } catch {
      notify("Não foi possível falar com o Professor IA.", "error");
    } finally {
      setCorrectingId(null);
    }
  }

  async function submitQuizAnswer() {
    if (!quizState) return;
    setQuizSubmitting(true);

    try {
      const response = await fetch(`/api/challenges/${quizState.challengeId}/quiz/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIndex: quizState.current, selectedOption: quizSelectedOption })
      });
      const data = await response.json();
      if (!response.ok) {
        notify(data.error || "Não foi possível corrigir o quiz.", "error");
        return;
      }
      setQuizResult(data);
      if (data.correct) {
        notify("Resposta correta! Veja a explicação abaixo.");
      } else {
        notify("Resposta incorreta. Leia a explicação e tente a próxima.", "error");
      }
    } catch {
      notify("Erro ao enviar resposta do quiz.", "error");
    } finally {
      setQuizSubmitting(false);
    }
  }

  function nextQuizQuestion() {
    if (!quizState) return;
    const nextIndex = quizState.current + 1;
    if (nextIndex >= quizState.questions.length) {
      setQuizState(null);
      setQuizSelectedOption(null);
      setQuizResult(null);
      notify("Quiz concluído. Continue revisando o conteúdo!");
      return;
    }
    setQuizState({ ...quizState, current: nextIndex });
    setQuizSelectedOption(null);
    setQuizResult(null);
  }

  function startEdit(challenge) {
    setEditing({
      id: challenge.id,
      type: challenge.type || "Pergunta Aberta",
      prompt: challenge.prompt || "",
      difficulty: challenge.difficulty || "Medio",
      status: challenge.status || "Pendente",
      due_at: challenge.due_at || ""
    });
  }

  async function saveEdit(event) {
    event.preventDefault();
    const response = await fetch(`/api/challenges/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      notify(data.error || "Não foi possível editar o desafio.", "error");
      return;
    }
    setEditing(null);
    await refresh();
    notify("Desafio atualizado.");
  }

  async function deleteChallenge(challenge) {
    if (!window.confirm(`Excluir o desafio "${challenge.prompt}"?`)) return;
    const response = await fetch(`/api/challenges/${challenge.id}`, { method: "DELETE" });
    if (!response.ok) {
      notify("Não foi possível excluir o desafio.", "error");
      return;
    }
    await refresh();
    notify("Desafio excluído.");
  }

  return (
    <section className="panel">
      <div className="professorHeader">
        <PanelTitle title="Modo IA Professor" />
        <span className={aiStatus?.configured ? "professorBadge active" : "professorBadge"}>
          {aiStatus?.configured ? `${providerLabel(aiStatus.provider)} conectado · ${aiStatus.model}` : "Correção local"}
        </span>
      </div>
      {editing && (
        <form className="cycleEditForm" onSubmit={saveEdit}>
          <PanelTitle title="Editar desafio" />
          <div className="formGrid">
            <Field label="Tipo">
              <input value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value })} />
            </Field>
            <Field label="Dificuldade">
              <select value={editing.difficulty} onChange={(event) => setEditing({ ...editing, difficulty: event.target.value })}>
                <option value="Facil">Fácil</option>
                <option value="Medio">Médio</option>
                <option value="Dificil">Difícil</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}>
                <option>Pendente</option>
                <option value="Concluido">Concluído</option>
              </select>
            </Field>
            <Field label="Prazo">
              <input type="date" value={editing.due_at || ""} onChange={(event) => setEditing({ ...editing, due_at: event.target.value })} />
            </Field>
          </div>
          <Field label="Pergunta">
            <textarea rows="3" value={editing.prompt} onChange={(event) => setEditing({ ...editing, prompt: event.target.value })} />
          </Field>
          <div className="buttonRow">
            <button className="primaryButton fit" type="submit"><Save size={18} />Salvar edição</button>
            <button className="secondaryButton fit" type="button" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {challenges.length === 0 && <EmptyState text="Cadastre conteúdos para gerar desafios." />}

      <div className="challengeSubjectStack">
        {groupedChallenges.map((group) => (
          <section className="challengeSubjectGroup" key={group.subject}>
            <header className="groupHeader">
              <h3>{group.subject}</h3>
              <span>{group.items.length} desafios</span>
            </header>
            <div className="challengeGrid">
              {group.items.map((challenge) => (
                <article className="challengeCard" key={challenge.id}>
                  <div className="tileFooter">
                    <span className="tag">{challenge.type}</span>
                    <span className={`dotStatus ${challenge.status === "Concluido" ? "done" : ""}`}>
                      {challenge.status === "Concluido" ? "Concluído" : challenge.status}
                    </span>
                  </div>
                  <div className="rowActions">
                    <button type="button" onClick={() => setVisibleAnswers((current) => ({ ...current, [challenge.id]: !current[challenge.id] }))} title="Ver resposta">
                      <BookOpen size={16} />
                    </button>
                    <button type="button" onClick={() => startEdit(challenge)} title="Editar desafio">
                      <Edit3 size={16} />
                    </button>
                    <button type="button" onClick={() => deleteChallenge(challenge)} title="Excluir desafio">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <h3>{challenge.prompt}</h3>
                  <p>{challenge.subject_name} - {challenge.topic_title}</p>
                  {visibleAnswers[challenge.id] && (
                    <div className="challengeAnswerBox">
                      <strong>Resposta-base</strong>
                      <p>{challenge.reference_answer || "Sem resposta-base cadastrada para este desafio."}</p>
                      {challenge.last_answer ? (
                        <>
                          <strong>Última resposta do aluno</strong>
                          <p>{challenge.last_answer}</p>
                        </>
                      ) : null}
                    </div>
                  )}
                  <textarea
                    rows="5"
                    value={answers[challenge.id] || ""}
                    onChange={(event) => setAnswers({ ...answers, [challenge.id]: event.target.value })}
                    placeholder="Digite sua resposta. O sistema vai comparar com o conteúdo importado e cadastrado."
                    disabled={challenge.status === "Concluido" || isLocked(challenge, results[challenge.id]) || correctingId === challenge.id}
                  />
                  <button
                    className="secondaryButton full"
                    type="button"
                    onClick={() => submitAnswer(challenge)}
                    disabled={challenge.status === "Concluido" || isLocked(challenge, results[challenge.id]) || correctingId === challenge.id}
                  >
                    <Sparkles size={18} />
                    {challenge.status === "Concluido" ? "Validado no dashboard" : correctingId === challenge.id ? "Professor corrigindo" : isLocked(challenge, results[challenge.id]) ? "Aguarde para tentar" : "Corrigir com IA Professor"}
                  </button>
                  <ChallengeFeedback challenge={challenge} result={results[challenge.id]} />
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {quizState && (
        <section className="panel quizPanel">
          <PanelTitle title={`Quiz rápido: ${quizState.topicTitle}`} action={`${quizState.current + 1}/${quizState.questions.length}`} />
          <p>Escolha a alternativa certa e veja a explicação imediata para cada pergunta.</p>
          <article className="quizQuestionCard">
            <div className="quizHeader">
              <strong>{quizState.questions[quizState.current].question}</strong>
              <span className="quizHint">{quizState.questions[quizState.current].hint}</span>
            </div>
            <div className="quizOptions">
              {quizState.questions[quizState.current].options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`quizOption ${quizSelectedOption === option.id ? "selected" : ""}`}
                  onClick={() => setQuizSelectedOption(option.id)}
                >
                  <span>{option.label}</span>
                  <p>{option.text}</p>
                </button>
              ))}
            </div>
            <div className="buttonRow">
              <button
                className="primaryButton fit"
                type="button"
                onClick={submitQuizAnswer}
                disabled={quizSubmitting || quizSelectedOption === null}
              >
                <CheckCircle2 size={18} />
                Verificar resposta
              </button>
              <button
                className="secondaryButton fit"
                type="button"
                onClick={nextQuizQuestion}
                disabled={quizSubmitting || !quizResult}
              >
                {quizState.current + 1 >= quizState.questions.length ? "Finalizar quiz" : "Próxima pergunta"}
              </button>
            </div>
            {quizResult && (
              <div className={quizResult.correct ? "quizResult success" : "quizResult error"}>
                <strong>{quizResult.correct ? "Correto" : "Incorreto"}</strong>
                <p>{quizResult.explanation}</p>
                {quizResult.correct_answer && (
                  <small>Alternativa correta: {quizResult.correct_option} — {quizResult.correct_answer}</small>
                )}
              </div>
            )}
          </article>
        </section>
      )}
    </section>
  );
}

function ChallengeFeedback({ challenge, result }) {
  const feedback = result?.feedback || challenge.feedback;
  const score = result?.score ?? challenge.score;
  const lockedUntil = result?.lockedUntil || challenge.locked_until;
  const locked = lockedUntil && new Date(lockedUntil) > new Date();
  const guidance = result?.guidance;
  const strengths = result?.strengths || [];
  const improvements = result?.improvements || [];
  const improvedAnswer = result?.improvedAnswer;
  const success = result?.correct || Number(score) > 50 || challenge.status === "Concluido";

  if (!feedback && !score && !locked) return null;

  return (
    <div className={success ? "challengeFeedback ok" : "challengeFeedback"}>
      {score ? <strong>{score}%</strong> : null}
      {result?.level ? <b>{result.level}</b> : null}
      {result?.evaluator ? <small>{result.evaluator === "professor-ai" ? "Corrigido pelo Professor IA" : "Corrigido pela IA local"}</small> : null}
      {feedback ? <span>{feedback}</span> : null}
      {guidance ? <small>{guidance}</small> : null}
      {strengths.length ? <small>Pontos fortes: {strengths.join("; ")}</small> : null}
      {improvements.length ? <small>Ajustes: {improvements.join("; ")}</small> : null}
      {improvedAnswer ? <small>Modelo de resposta: {improvedAnswer}</small> : null}
      {locked ? <small>Nova tentativa liberada em {formatTime(lockedUntil)}</small> : null}
      {result?.matchedTerms?.length ? <small>Termos reconhecidos: {result.matchedTerms.join(", ")}</small> : null}
      {result?.missingTerms?.length ? <small>Faltou citar: {result.missingTerms.join(", ")}</small> : null}
    </div>
  );
}

function ExamView({ topics, notify, refresh, goTo }) {
  const [count, setCount] = useState(10);
  const [exam, setExam] = useState(null);

  async function generate() {
    const response = await fetch(`/api/exam?count=${count}`);
    const data = await response.json();
    setExam(data);
    notify(`Simulado com ${data.count} questões gerado.`);
  }

  async function finish() {
    for (const question of exam.questions) {
      await fetch(`/api/topics/${question.topic_id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_confidence: 3 })
      });
    }
    notify("Simulado finalizado. Revisões atualizadas.");
    await refresh();
    goTo("dashboard");
  }

  if (topics.length === 0) return <EmptyAction title="Sem questões" text="Cadastre conteúdos para montar simulados inteligentes." />;

  return (
    <section className="panel">
      <div className="simToolbar">
        {[10, 20, 50, 100].map((amount) => <button type="button" className={count === amount ? "active" : ""} onClick={() => setCount(amount)} key={amount}>{amount} questões</button>)}
        <button className="primaryButton" type="button" onClick={generate}><Zap size={18} />Gerar simulado</button>
      </div>
      <div className="quizList">
        {(exam?.questions || []).map((item, index) => (
          <article className="questionCard" key={`${item.topic_id}-${index}`}>
            <span>{item.subject} · {item.topic} · {item.difficulty}</span>
            <strong>{index + 1}. {item.question}</strong>
            <textarea rows="3" placeholder="Sua resposta" />
          </article>
        ))}
      </div>
      {exam && <button className="primaryButton fit" type="button" onClick={finish}><CheckCircle2 size={18} />Finalizar simulado</button>}
    </section>
  );
}

function PredictionsView({ predictions, refresh, notify }) {
  const emptyForm = { professor: "", subject: "", exam_date: "", required_grade: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  function startEdit(plan) {
    setEditingId(plan.id);
    setForm({
      professor: plan.professor,
      subject: plan.subject,
      exam_date: plan.exam_date || "",
      required_grade: String(plan.required_grade || "")
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      const method = editingId ? "PATCH" : "POST";
      const url = editingId ? `/api/predictions/${editingId}` : "/api/predictions";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          professor: form.professor,
          subject: form.subject,
          exam_date: form.exam_date,
          required_grade: Number(form.required_grade)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a prova.");
      await refresh();
      resetForm();
      notify(editingId ? "Prova atualizada." : "Prova cadastrada.");
    } catch (error) {
      notify(error.message || "Erro ao salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(plan) {
    if (!window.confirm(`Excluir a prova de ${plan.subject} com ${plan.professor}?`)) return;
    const response = await fetch(`/api/predictions/${plan.id}`, { method: "DELETE" });
    if (!response.ok) {
      notify("Não foi possível excluir a prova.", "error");
      return;
    }
    await refresh();
    if (editingId === plan.id) resetForm();
    notify("Prova excluída.");
  }

  return (
    <section className="splitView">
      <form className="panel dataForm" onSubmit={submit}>
        <PanelTitle title={editingId ? "Editar prova" : "Cadastrar prova"} />
        <Field label="Nome do professor">
          <input value={form.professor} onChange={(event) => setForm({ ...form, professor: event.target.value })} placeholder="Nome do professor" required />
        </Field>
        <Field label="Matéria">
          <input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Matéria da prova" required />
        </Field>
        <div className="formGrid">
          <Field label="Data da prova">
            <input type="date" value={form.exam_date} onChange={(event) => setForm({ ...form, exam_date: event.target.value })} required />
          </Field>
          <Field label="Nota mínima">
            <input type="number" min="0" max="10" step="0.1" value={form.required_grade} onChange={(event) => setForm({ ...form, required_grade: event.target.value })} placeholder="8.0" required />
          </Field>
        </div>
        <div className="buttonRow">
          <button className="primaryButton fit" type="submit" disabled={saving}>
            <Save size={18} />
            {saving ? "Salvando..." : editingId ? "Atualizar prova" : "Salvar prova"}
          </button>
          {editingId && (
            <button className="secondaryButton fit" type="button" onClick={resetForm}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <section className="panel">
        <PanelTitle title="Provas agendadas" />
        <div className="examPlanList">
          {predictions.map((plan) => (
            <article className="subjectRow" key={plan.id}>
              <BookOpen size={20} />
              <div>
                <strong>{plan.subject}</strong>
                <span>{plan.professor} · {plan.exam_date || "Sem data"}</span>
              </div>
              <b>{Number(plan.required_grade).toFixed(1)}</b>
              <div className="rowActions">
                <button type="button" onClick={() => startEdit(plan)} title="Editar prova"><Edit3 size={16} /></button>
                <button type="button" onClick={() => deletePlan(plan)} title="Excluir prova"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {predictions.length === 0 && <EmptyState text="Nenhuma prova cadastrada ainda." />}
        </div>
      </section>
    </section>
  );
}

function AchievementsView({ dashboard }) {
  return (
    <section className="panel">
      <PanelTitle title="Conquistas e Medalhas" />
      <div className="badgeGrid large">
        {(dashboard?.achievements || []).map((item) => <BadgeCard item={item} key={item.title} />)}
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value, hint, tone }) {
  return (
    <article className={`metric ${tone}`}>
      <div className="metricIcon"><Icon size={22} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  );
}

function PanelTitle({ title, action, onAction }) {
  return (
    <div className="panelTitle">
      <h3>{title}</h3>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

function PredictionBar({ item, wide = false }) {
  const tone = item.chance >= 80 ? "green" : item.chance >= 60 ? "yellow" : "red";
  return (
    <article className={wide ? "predictionRow wide" : "predictionRow"}>
      <strong>{item.theme}</strong>
      {wide && <span>{item.subject}</span>}
      <div className="barTrack"><div className={tone} style={{ width: `${item.chance}%` }} /></div>
      <b>{item.chance}%</b>
    </article>
  );
}

function ExamPlanCard({ item }) {
  return (
    <article className="predictionRow wide">
      <strong>{item.subject}</strong>
      <span>{item.professor}</span>
      <div className="barTrack examDateTrack">
        <div className="green" style={{ width: "100%" }} />
      </div>
      <div className="examPlanMeta">
        <b>{item.exam_date || "Sem data"}</b>
        <small>Nota alvo {Number(item.required_grade).toFixed(1)}</small>
      </div>
    </article>
  );
}

function Legend({ color, label, value }) {
  return <div className="legendRow"><span className={color} /><strong>{label}</strong><b>{value}</b></div>;
}

function BadgeCard({ item }) {
  return (
    <article className={item.earned ? "badgeCard earned" : "badgeCard"}>
      <Award size={31} />
      <div>
        <strong>{item.title}</strong>
        <span>{item.detail}</span>
      </div>
    </article>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Range({ value, min, max, onChange }) {
  return <div className="rangeWrap"><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} /><b>{value}</b></div>;
}

function StatusPill({ status }) {
  return <span className={`status ${String(status).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-")}`}>{status}</span>;
}

function EmptyState({ text }) {
  return <div className="emptyState">{text}</div>;
}

function EmptyAction({ title, text, action, onClick }) {
  return (
    <section className="emptyHero">
      <div><h3>{title}</h3><p>{text}</p></div>
      {action && <button className="primaryButton" type="button" onClick={onClick}><Plus size={18} />{action}</button>}
    </section>
  );
}

function formatHours(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}m`;
}

function providerLabel(provider) {
  if (!provider) return "IA";
  const labels = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    azure: "Azure AI",
    google: "Google AI",
    cohere: "Cohere"
  };
  return labels[provider.toLowerCase()] || provider;
}

function daysUntil(date) {
  if (!date) return "-";
  const today = new Date();
  const target = new Date(`${date}T00:00:00`);
  return Math.max(0, Math.ceil((target - today) / 86400000));
}

function isLocked(challenge, result) {
  const lockedUntil = result?.lockedUntil || challenge.locked_until;
  return Boolean(lockedUntil && new Date(lockedUntil) > new Date());
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function normalizeLoginPayload(payload) {
  if (typeof payload === "string") return { name: payload.trim(), provider: "manual" };
  if (!payload || typeof payload !== "object") return { name: "", provider: "manual" };
  return {
    name: String(payload.name || "").trim(),
    email: String(payload.email || "").trim(),
    googleSub: String(payload.googleSub || "").trim(),
    picture: String(payload.picture || "").trim(),
    provider: String(payload.provider || "manual").trim()
  };
}

function decodeGoogleCredential(credential) {
  try {
    const token = String(credential || "");
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(payload));
    return {
      name: decoded.name || decoded.given_name || "",
      email: decoded.email || "",
      picture: decoded.picture || "",
      googleSub: decoded.sub || ""
    };
  } catch {
    return null;
  }
}

function getStoredProfile() {
  const raw = safeStorageGet("prepara:userProfile", "");
  if (!raw) return null;
  try {
    return normalizeLoginPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorText: "" };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    const errorText = error?.message || String(error || "Erro desconhecido");
    this.setState({ errorText });
    // Keep a trace for easier local debug
    // eslint-disable-next-line no-console
    console.error("Falha ao renderizar o app:", errorText, error?.stack || "");
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="loginScreen">
          <section className="loginPanel">
            <h1>O sistema encontrou um erro</h1>
            <p>Atualize a página. Se continuar em branco, limpe o armazenamento do site e tente novamente.</p>
            {this.state.errorText ? <p><strong>Detalhe:</strong> {this.state.errorText}</p> : null}
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);



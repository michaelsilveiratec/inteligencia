import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Atom,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Circle,
  Download,
  Edit3,
  FlaskConical,
  GraduationCap,
  Home,
  Landmark,
  Leaf,
  ListChecks,
  LogOut,
  Medal,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trophy,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import "./styles.css";

const iconMap = {
  Atom,
  BookOpen,
  Calculator,
  FlaskConical,
  GraduationCap,
  Landmark,
  Leaf
};

const navItems = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "history", label: "Historico", icon: ListChecks },
  { id: "ranking", label: "Ranking", icon: BarChart3 },
  { id: "profile", label: "Perfil", icon: UserRound },
  { id: "admin", label: "Cadastrar", icon: Plus }
];

const emptyQuestionForm = {
  professor: "",
  subject: "",
  statement: "",
  alternatives: ["", "", "", ""],
  correctIndex: 0,
  icon: "BookOpen",
  color: "#1677ff",
  difficulty: "Media"
};

function App() {
  const [active, setActive] = useState("home");
  const [subjects, setSubjects] = useState([]);
  const [history, setHistory] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [profile, setProfile] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingSubject, setEditingSubject] = useState(null);

  useEffect(() => {
    refreshAll();
  }, []);

  async function refreshAll() {
    setLoading(true);
    try {
      const [subjectsData, historyData, rankingData, profileData] = await Promise.all([
        apiGet("/api/subjects"),
        apiGet("/api/history"),
        apiGet("/api/ranking"),
        apiGet("/api/profile")
      ]);
      setSubjects(subjectsData);
      setHistory(historyData);
      setRanking(rankingData);
      setProfile(profileData);
    } catch (error) {
      showNotice(error.message || "Falha ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  async function startQuiz(subject) {
    try {
      const data = await apiGet(`/api/subjects/${subject.id}/quiz`);
      if (!data.questions.length) {
        showNotice("Esta materia ainda nao possui questoes.");
        return;
      }
      setQuiz(data);
      setQuestionIndex(0);
      setAnswers({});
      setResult(null);
      setActive("quiz");
    } catch (error) {
      showNotice(error.message || "Nao foi possivel abrir o quiz.");
    }
  }

  function selectAlternative(questionId, alternativeId) {
    setAnswers((current) => ({ ...current, [questionId]: alternativeId }));
  }

  async function finishQuiz() {
    if (!quiz) return;
    try {
      const payload = {
        answers: quiz.questions.map((question) => ({
          questionId: question.id,
          alternativeId: answers[question.id] || null
        }))
      };
      const data = await apiPost(`/api/subjects/${quiz.subject.id}/attempts`, payload);
      setResult(data);
      setActive("result");
      await refreshAll();
    } catch (error) {
      showNotice(error.message || "Nao foi possivel finalizar o quiz.");
    }
  }

  function exitQuiz() {
    setQuiz(null);
    setResult(null);
    setAnswers({});
    setQuestionIndex(0);
    setActive("home");
  }

  async function updateSubject(payload) {
    if (!editingSubject) return;
    try {
      await apiPatch(`/api/subjects/${editingSubject.id}`, payload);
      setEditingSubject(null);
      showNotice("Materia atualizada.");
      await refreshAll();
    } catch (error) {
      showNotice(error.message || "Nao foi possivel atualizar.");
    }
  }

  async function deleteSubject(subject) {
    const confirmed = window.confirm(`Excluir "${subject.nome}" e todas as questoes dessa materia?`);
    if (!confirmed) return;
    try {
      await apiDelete(`/api/subjects/${subject.id}`);
      showNotice("Materia excluida.");
      await refreshAll();
    } catch (error) {
      showNotice(error.message || "Nao foi possivel excluir.");
    }
  }

  const currentQuestion = quiz?.questions?.[questionIndex] || null;
  const answeredCount = quiz?.questions?.filter((question) => answers[question.id]).length || 0;

  return (
    <div className="appShell">
      <Sidebar active={active} setActive={setActive} onExitQuiz={exitQuiz} />
      <main className="contentShell">
        {notice && <div className="notice">{notice}</div>}
        {active === "home" && (
          <HomeScreen
            subjects={subjects}
            history={history}
            loading={loading}
            onStartQuiz={startQuiz}
            onEditSubject={setEditingSubject}
            onDeleteSubject={deleteSubject}
          />
        )}
        {active === "quiz" && quiz && currentQuestion && (
          <QuizScreen
            quiz={quiz}
            question={currentQuestion}
            questionIndex={questionIndex}
            answeredCount={answeredCount}
            answers={answers}
            onSelectAlternative={selectAlternative}
            onPrevious={() => setQuestionIndex((index) => Math.max(0, index - 1))}
            onNext={() => setQuestionIndex((index) => Math.min(quiz.questions.length - 1, index + 1))}
            onFinish={finishQuiz}
            onBack={exitQuiz}
          />
        )}
        {active === "result" && result && (
          <ResultScreen result={result} onRestart={() => startQuiz(result.subject)} onHome={exitQuiz} />
        )}
        {active === "history" && <HistoryScreen history={history} />}
        {active === "ranking" && <RankingScreen ranking={ranking} />}
        {active === "profile" && <ProfileScreen profile={profile} />}
        {active === "admin" && (
          <AdminScreen
            subjects={subjects}
            onSaved={async (message) => {
              showNotice(message);
              await refreshAll();
            }}
          />
        )}
      </main>
      {editingSubject && (
        <SubjectEditor
          subject={editingSubject}
          onCancel={() => setEditingSubject(null)}
          onSave={updateSubject}
        />
      )}
      <MobileNav active={active} setActive={setActive} />
    </div>
  );
}

function Sidebar({ active, setActive, onExitQuiz }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><GraduationCap size={24} /></div>
        <strong>Estuda+</strong>
      </div>
      <nav className="navList">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={active === item.id ? "navItem active" : "navItem"}
              type="button"
              key={item.id}
              onClick={() => setActive(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="navItem logout" type="button" onClick={onExitQuiz}>
        <LogOut size={18} />
        <span>Sair</span>
      </button>
    </aside>
  );
}

function MobileNav({ active, setActive }) {
  return (
    <nav className="mobileNav">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={active === item.id ? "active" : ""}
            type="button"
            key={item.id}
            onClick={() => setActive(item.id)}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function HomeScreen({ subjects, history, loading, onStartQuiz, onEditSubject, onDeleteSubject }) {
  const lastAttempt = history[0];

  return (
    <section className="screenStack">
      <header className="welcomePanel">
        <div>
          <span className="eyebrow">Bem-vindo!</span>
          <h1>Escolha uma materia para iniciar seu quiz.</h1>
          <p>Cada disciplina carrega apenas as proprias questoes. Nada de perguntas misturadas.</p>
        </div>
        <div className="welcomeBadge">
          <Sparkles size={22} />
          <strong>{subjects.length}</strong>
          <span>materias ativas</span>
        </div>
      </header>

      <div className="dashboardGrid">
        <section className="subjectGrid">
          {subjects.map((subject) => (
            <SubjectCard
              subject={subject}
              key={subject.id}
              onStartQuiz={onStartQuiz}
              onEditSubject={onEditSubject}
              onDeleteSubject={onDeleteSubject}
            />
          ))}
          {!loading && subjects.length === 0 && (
            <div className="emptyState">Cadastre uma questao para criar a primeira materia.</div>
          )}
        </section>

        <aside className="sidePanel">
          <h2>Resumo</h2>
          <Metric label="Quizzes feitos" value={history.length} />
          <Metric label="Ultima pontuacao" value={lastAttempt ? `${lastAttempt.pontuacao}%` : "0%"} />
          <Metric label="Ultima materia" value={lastAttempt?.materia || "-"} />
        </aside>
      </div>
    </section>
  );
}

function SubjectCard({ subject, onStartQuiz, onEditSubject, onDeleteSubject }) {
  const Icon = iconMap[subject.icone] || BookOpen;

  return (
    <article className="subjectCard">
      <div className="subjectActions">
        <button type="button" onClick={() => onEditSubject(subject)} title="Editar materia">
          <Edit3 size={16} />
        </button>
        <button type="button" onClick={() => onDeleteSubject(subject)} title="Excluir materia">
          <Trash2 size={16} />
        </button>
      </div>
      <button className="subjectOpenButton" type="button" onClick={() => onStartQuiz(subject)}>
        <div className="subjectIcon" style={{ color: subject.cor, background: hexToTint(subject.cor) }}>
          <Icon size={34} />
        </div>
        <strong>{subject.nome}</strong>
        <span>{subject.professor}</span>
        <small>{subject.total_questoes} questoes</small>
        <ChevronRight className="cardArrow" size={18} />
      </button>
    </article>
  );
}

function SubjectEditor({ subject, onCancel, onSave }) {
  const [form, setForm] = useState({
    name: subject.nome,
    professor: subject.professor,
    icon: subject.icone,
    color: subject.cor
  });

  function submit(event) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="subjectEditor" onSubmit={submit}>
        <header>
          <div>
            <h2>Editar materia</h2>
            <p>Atualize o card exibido na tela inicial.</p>
          </div>
          <button className="iconOnlyButton" type="button" onClick={onCancel} title="Fechar">
            <X size={18} />
          </button>
        </header>
        <label>
          <span>Materia</span>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label>
          <span>Professor</span>
          <input value={form.professor} onChange={(event) => setForm({ ...form, professor: event.target.value })} required />
        </label>
        <div className="editorGrid">
          <label>
            <span>Icone</span>
            <select value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
              {Object.keys(iconMap).map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Cor</span>
            <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
          </label>
        </div>
        <div className="modalActions">
          <button className="secondaryButton" type="button" onClick={onCancel}>Cancelar</button>
          <button className="primaryButton" type="submit">
            <Save size={18} />
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}

function QuizScreen({
  quiz,
  question,
  questionIndex,
  answeredCount,
  answers,
  onSelectAlternative,
  onPrevious,
  onNext,
  onFinish,
  onBack
}) {
  const total = quiz.questions.length;
  const progress = Math.round(((questionIndex + 1) / total) * 100);
  const selected = answers[question.id];
  const isLast = questionIndex + 1 === total;

  return (
    <section className="quizScreen">
      <header className="quizHeader">
        <button className="ghostButton" type="button" onClick={onBack}>
          <ArrowLeft size={18} />
          Voltar
        </button>
        <div>
          <strong>{quiz.subject.nome}</strong>
          <span>{quiz.subject.professor}</span>
        </div>
        <small>Questao {questionIndex + 1} de {total}</small>
      </header>

      <div className="progressBar">
        <span style={{ width: `${progress}%` }} />
      </div>

      <article className="questionPanel">
        <div className="questionMeta">
          <span>{question.dificuldade}</span>
          <b>{answeredCount}/{total} respondidas</b>
        </div>
        <h1>{question.enunciado}</h1>
        <div className="alternativeList">
          {question.alternatives.map((alternative, index) => (
            <button
              className={selected === alternative.id ? "alternative selected" : "alternative"}
              type="button"
              key={alternative.id}
              onClick={() => onSelectAlternative(question.id, alternative.id)}
            >
              {selected === alternative.id ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              <span>{String.fromCharCode(65 + index)}) {alternative.texto}</span>
            </button>
          ))}
        </div>
      </article>

      <div className="quizActions">
        <button className="secondaryButton" type="button" onClick={onPrevious} disabled={questionIndex === 0}>
          Anterior
        </button>
        {isLast ? (
          <button className="primaryButton" type="button" onClick={onFinish} disabled={answeredCount < total}>
            Finalizar quiz
          </button>
        ) : (
          <button className="primaryButton" type="button" onClick={onNext} disabled={!selected}>
            Proxima
          </button>
        )}
      </div>
    </section>
  );
}

function ResultScreen({ result, onRestart, onHome }) {
  return (
    <section className="resultScreen">
      <div className="resultHero">
        <Trophy size={74} />
        <span>Quiz concluido!</span>
        <h1>{result.subject.nome}</h1>
        <div className="scoreCircle">
          <strong>{result.score}%</strong>
        </div>
        <p>{result.correctCount} de {result.total} acertos</p>
        <div className="scoreStats">
          <Metric label="Acertos" value={result.correctCount} />
          <Metric label="Erros" value={result.total - result.correctCount} />
          <Metric label="Total" value={result.total} />
        </div>
      </div>

      <section className="detailPanel">
        <h2>Detalhes</h2>
        {result.details.map((detail, index) => (
          <article className={detail.correct ? "detailRow ok" : "detailRow"} key={detail.questionId}>
            <b>{index + 1}</b>
            <div>
              <strong>{detail.question}</strong>
              <span>Sua resposta: {detail.selectedText || "Nao respondida"}</span>
              {!detail.correct && <small>Correta: {detail.correctText}</small>}
            </div>
          </article>
        ))}
      </section>

      <div className="resultActions">
        <button className="primaryButton" type="button" onClick={onRestart}>
          <RotateCcw size={18} />
          Refazer
        </button>
        <button className="secondaryButton" type="button" onClick={onHome}>
          Voltar ao inicio
        </button>
      </div>
    </section>
  );
}

function HistoryScreen({ history }) {
  return (
    <section className="panelScreen">
      <HeaderBlock title="Historico" subtitle="Veja suas tentativas por materia." />
      <div className="historyList">
        {history.map((attempt) => (
          <article className="historyRow" key={attempt.id}>
            <div>
              <strong>{attempt.materia}</strong>
              <span>{attempt.professor}</span>
              <small>{formatDate(attempt.criado_em)}</small>
            </div>
            <div className="miniBar">
              <span style={{ width: `${attempt.pontuacao}%` }} />
            </div>
            <b>{attempt.pontuacao}%</b>
            <small>{attempt.acertos}/{attempt.total_questoes} acertos</small>
          </article>
        ))}
        {!history.length && <div className="emptyState">Nenhuma tentativa registrada ainda.</div>}
      </div>
    </section>
  );
}

function RankingScreen({ ranking }) {
  return (
    <section className="panelScreen">
      <HeaderBlock title="Ranking" subtitle="Melhores desempenhos por materia." />
      <div className="rankingList">
        {ranking.map((item, index) => (
          <article className="rankingRow" key={`${item.materia}-${item.professor}`}>
            <div className="rankPosition"><Medal size={20} /> {index + 1}</div>
            <div>
              <strong>{item.materia}</strong>
              <span>{item.professor}</span>
            </div>
            <b>{item.melhor_pontuacao}%</b>
            <small>{item.tentativas} tentativas</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProfileScreen({ profile }) {
  const stats = profile?.stats || {};
  return (
    <section className="panelScreen">
      <HeaderBlock title="Perfil" subtitle="Resumo do aluno." />
      <div className="profileCard">
        <div className="avatar">A</div>
        <div>
          <h2>{profile?.user?.nome || "Aluno"}</h2>
          <p>{profile?.user?.email || "sem email"}</p>
        </div>
      </div>
      <div className="metricGrid">
        <Metric label="Tentativas" value={stats.attempts || 0} />
        <Metric label="Acertos" value={stats.correct || 0} />
        <Metric label="Erros" value={stats.wrong || 0} />
        <Metric label="Media" value={`${stats.average || 0}%`} />
      </div>
    </section>
  );
}

function AdminScreen({ subjects, onSaved }) {
  const [form, setForm] = useState(emptyQuestionForm);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const subjectNames = useMemo(() => [...new Set(subjects.map((item) => item.nome))], [subjects]);

  function updateAlternative(index, value) {
    setForm((current) => {
      const alternatives = current.alternatives.slice();
      alternatives[index] = value;
      return { ...current, alternatives };
    });
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiPost("/api/admin/questions", form);
      setForm(emptyQuestionForm);
      await onSaved("Questao cadastrada. Se for uma nova materia, ela ja aparece no inicio.");
    } catch (error) {
      await onSaved(error.message || "Nao foi possivel salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function exportBackup() {
    try {
      const backup = await apiGet("/api/backup");
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `estuda-plus-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      await onSaved("Backup exportado.");
    } catch (error) {
      await onSaved(error.message || "Nao foi possivel exportar.");
    }
  }

  async function restoreBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setRestoring(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (backup?.tables) {
        const confirmed = window.confirm("Restaurar este backup vai substituir os dados atuais. Continuar?");
        if (!confirmed) return;
        await apiPost("/api/backup/restore", backup);
        await onSaved("Backup restaurado.");
      } else {
        const result = await apiPost("/api/admin/questions/import", backup);
        await onSaved(`${result.imported} questoes importadas.`);
      }
    } catch (error) {
      await onSaved(error.message || "Nao foi possivel restaurar o backup.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="panelScreen">
      <HeaderBlock
        title="Cadastrar questao"
        subtitle="Novas materias sao criadas automaticamente pelo cadastro de questoes."
      />
      <div className="backupPanel">
        <div>
          <strong>Backup dos dados</strong>
          <span>Exporte antes do deploy ou restaure um arquivo salvo anteriormente.</span>
        </div>
        <div className="backupActions">
          <button className="secondaryButton" type="button" onClick={exportBackup}>
            <Download size={18} />
            Exportar
          </button>
          <label className={restoring ? "secondaryButton disabled" : "secondaryButton"}>
            <Upload size={18} />
            {restoring ? "Restaurando..." : "Importar"}
            <input type="file" accept="application/json,.json" onChange={restoreBackup} disabled={restoring} />
          </label>
        </div>
      </div>
      <form className="adminForm" onSubmit={submit}>
        <label>
          <span>Professor</span>
          <input value={form.professor} onChange={(event) => setForm({ ...form, professor: event.target.value })} placeholder="Prof. Mariana" required />
        </label>
        <label>
          <span>Materia</span>
          <input list="materias" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Engenharia de Software" required />
          <datalist id="materias">
            {subjectNames.map((name) => <option value={name} key={name} />)}
          </datalist>
        </label>
        <label className="wide">
          <span>Enunciado</span>
          <textarea value={form.statement} onChange={(event) => setForm({ ...form, statement: event.target.value })} rows="4" placeholder="O que e Scrum?" required />
        </label>
        <div className="alternativeEditor wide">
          {form.alternatives.map((alternative, index) => (
            <label key={index}>
              <span>Alternativa {String.fromCharCode(65 + index)}</span>
              <div className="alternativeInput">
                <input value={alternative} onChange={(event) => updateAlternative(index, event.target.value)} required={index < 2} />
                <button
                  className={form.correctIndex === index ? "correctToggle active" : "correctToggle"}
                  type="button"
                  onClick={() => setForm({ ...form, correctIndex: index })}
                  title="Marcar como correta"
                >
                  <CheckCircle2 size={18} />
                </button>
              </div>
            </label>
          ))}
        </div>
        <label>
          <span>Icone</span>
          <select value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
            {Object.keys(iconMap).map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>Cor</span>
          <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
        </label>
        <button className="primaryButton wide" type="submit" disabled={saving}>
          <Save size={18} />
          {saving ? "Salvando..." : "Salvar questao"}
        </button>
      </form>
    </section>
  );
}

function HeaderBlock({ title, subtitle }) {
  return (
    <header className="sectionHeader">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

async function apiGet(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro de API.");
  return data;
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro de API.");
  return data;
}

async function apiPatch(path, payload) {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro de API.");
  return data;
}

async function apiDelete(path) {
  const response = await fetch(path, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro de API.");
  return data;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function hexToTint(hex) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#1677ff";
  return `${safe}18`;
}

createRoot(document.getElementById("root")).render(<App />);

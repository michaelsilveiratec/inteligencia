export const SOFTWARE_QUIZ_MARKER = "quiz-importado-agil-scrum-uml-2026-06-01";

const SEEDED_USER_IDS = ["default", "rmaicom26@gmail.com"];
const SUBJECT_NAME = "Engenharia Software";

const QUIZ_ITEMS = [
  {
    section: "Manifesto Ágil",
    question: "Explique como a excelência técnica e o bom design influenciam diretamente na agilidade de uma equipe a longo prazo.",
    answer: "Um bom design permite que o sistema seja bem organizado, com uma arquitetura limpa, códigos bem definidos e testes automatizados. Vamos supor que em um projeto não exista cuidado com a implementação dos códigos, entregas e prazos; o sistema ficará difícil de manter e modificar, o que poderá acarretar vários problemas no futuro. Portanto, um bom design garante mais qualidade técnica, aumenta a produtividade da equipe e torna o desenvolvimento mais ágil e sustentável."
  },
  {
    section: "Manifesto Ágil",
    question: "Discorra sobre o conceito de ritmo sustentável e quais os riscos para o projeto caso a equipe seja submetida a sobrecargas constantes.",
    answer: "O ritmo sustentável significa trabalhar em uma velocidade constante e equilibrada, sem colocar pressão excessiva que possa prejudicar a equipe. Quando existe uma sobrecarga constante, aumentam os erros, atrasos e o estresse dos membros da equipe, o que pode acarretar desmotivação e até o abandono do projeto por alguns integrantes."
  },
  {
    section: "Manifesto Ágil",
    question: "Analise a importância de priorizar \"Indivíduos e interações\" sobre \"Processos e ferramentas\" no contexto de desenvolvimento de software.",
    answer: "Processos e ferramentas são importantes para ajudar no desenvolvimento, mas softwares são feitos por pessoas e para pessoas. Não adianta ter as melhores ferramentas do mercado se a equipe não consegue se comunicar bem. Quando priorizamos indivíduos e interações, os problemas são resolvidos mais rapidamente através da conversa e da colaboração da equipe."
  },
  {
    section: "Manifesto Ágil",
    question: "Como a prática de \"Responder a mudanças\" em vez de \"Seguir um plano\" beneficia o desenvolvimento em ambientes de alta incerteza?",
    answer: "Em ambientes de alta incerteza, onde a tecnologia muda rápido ou até mesmo o cliente não sabe exatamente o que quer, seguir um plano rígido pode acabar prejudicando o projeto. Muitas vezes o time pode desenvolver algo que no final nem terá mais valor. Responder às mudanças permite que a equipe corrija a rota durante o desenvolvimento através dos feedbacks recebidos."
  },
  {
    section: "Manifesto Ágil",
    question: "De que forma a colaboração com o cliente pode reduzir os atritos geralmente encontrados em negociações contratuais rígidas?",
    answer: "Contratos muito rígidos podem acabar gerando discussões sobre mudanças, custos e prazos durante o projeto. Quando existe colaboração entre o cliente e a equipe, fica mais fácil alinhar ideias e resolver problemas juntos. Assim, ao invés de ficar preso somente ao que foi combinado no começo, o cliente participa do desenvolvimento e ajuda a equipe a entender o que é mais importante no momento."
  },
  {
    section: "Modelo Híbrido e Ciclo de Vida",
    question: "Descreva como o Modelo Híbrido concilia a previsibilidade do planejamento macro (Cascata) com a flexibilidade da execução (Ágil).",
    answer: "No modelo híbrido, primeiro é feito um planejamento geral do projeto, definindo orçamento, prazos e a estrutura do sistema. Depois, o desenvolvimento acontece de forma ágil, em pequenas etapas, permitindo mudanças e melhorias durante o processo sem perder o foco do planejamento inicial."
  },
  {
    section: "Modelo Híbrido e Ciclo de Vida",
    question: "Em que tipos de projetos ou contextos organizacionais o uso de um modelo híbrido é mais recomendado e por quê?",
    answer: "O modelo híbrido é mais recomendado em projetos grandes e empresas que precisam de organização e planejamento, mas também querem flexibilidade durante o desenvolvimento. Ele ajuda a manter controle de prazos e custos, permitindo mudanças e melhorias ao longo do projeto."
  },
  {
    section: "Modelo Híbrido e Ciclo de Vida",
    question: "Explique o papel da definição da arquitetura e do backlog inicial na fase preditiva de um modelo híbrido.",
    answer: "A definição da arquitetura ajuda a criar uma base organizada e segura para o sistema, evitando problemas futuros no desenvolvimento. Já o backlog inicial serve para listar as principais funcionalidades do projeto, ajudando no planejamento de custos, prazos e organização das entregas."
  },
  {
    section: "Modelo Híbrido e Ciclo de Vida",
    question: "Diferencie a abordagem de planejamento \"pesado e linear\" do modelo Cascata frente à abordagem iterativa do Scrum.",
    answer: "No modelo Cascata, todo o planejamento é feito do início ao fim do projeto, seguindo etapas fixas e sequenciais. Já no Scrum, o planejamento acontece aos poucos, em pequenas etapas chamadas Sprints, permitindo mudanças e melhorias durante o desenvolvimento do software."
  },
  {
    section: "Modelo Híbrido e Ciclo de Vida",
    question: "Liste e explique as funções práticas de cada etapa do ciclo de vida do software, desde a concepção até a manutenção.",
    answer: "Levantamento de Requisitos: entender as necessidades do usuário e definir as funcionalidades do sistema. Projeto (Design/Modelagem): criação da estrutura do sistema, banco de dados e telas. Implementação: desenvolvimento e codificação do sistema. Testes: verificação de erros, segurança e funcionamento do software. Implantação: colocar o sistema em funcionamento para os usuários. Manutenção: corrigir falhas e realizar melhorias no sistema após o lançamento."
  },
  {
    section: "Papéis e Responsabilidades no Scrum",
    question: "Analise a função do Scrum Master como um \"líder servidor\" e dê exemplos de como ele remove impedimentos.",
    answer: "O Scrum Master não é um chefe que manda na equipe, mas sim alguém que ajuda o time a trabalhar melhor. Ele garante que o Scrum seja seguido corretamente e ajuda a resolver problemas que podem atrapalhar o desenvolvimento."
  },
  {
    section: "Papéis e Responsabilidades no Scrum",
    question: "Qual a importância do Product Owner possuir autoridade total sobre a priorização do Product Backlog?",
    answer: "O Product Owner precisa ter autoridade para definir as prioridades do backlog, porque isso ajuda o projeto a ter organização e foco. Se várias pessoas mudarem as prioridades toda hora, a equipe pode ficar perdida e o desenvolvimento atrasar. O P.O. analisa o que é mais importante para o produto e define a direção que o time deve seguir."
  },
  {
    section: "Papéis e Responsabilidades no Scrum",
    question: "Explique as características de um time de Developers auto-organizável e multidisciplinar.",
    answer: "Um time auto-organizável é aquele que consegue dividir as tarefas e organizar o próprio trabalho sem precisar que alguém mande em tudo. Já um time multidisciplinar possui diferentes conhecimentos, como programação, banco de dados e testes, permitindo que a equipe consiga desenvolver o projeto completo sem depender de outras pessoas de fora do time."
  },
  {
    section: "Papéis e Responsabilidades no Scrum",
    question: "Como o perfil técnico e comportamental dos papéis do Scrum se complementam para a entrega de valor?",
    answer: "No Scrum, cada papel ajuda de uma forma diferente no projeto. O Product Owner define o que é mais importante para o produto, os Developers desenvolvem o sistema com qualidade e o Scrum Master ajuda a equipe a trabalhar melhor e resolver problemas. Juntos, eles conseguem organizar o trabalho e entregar mais valor para o cliente."
  },
  {
    section: "Papéis e Responsabilidades no Scrum",
    question: "Discorra sobre a responsabilidade dos desenvolvedores em relação ao gerenciamento de seu próprio trabalho durante a Sprint.",
    answer: "Durante a Sprint, os desenvolvedores são responsáveis por organizar e acompanhar o próprio trabalho para atingir os objetivos definidos. Eles dividem as tarefas, acompanham o progresso diariamente e avisam quando aparece algum problema que possa atrasar a entrega. Além disso, precisam garantir que o trabalho seja feito com qualidade e dentro do que foi combinado para a Sprint."
  },
  {
    section: "Requisitos e Histórias de Usuário",
    question: "Descreva a estrutura padrão de uma História de Usuário e como cada parte ajuda no entendimento da funcionalidade.",
    answer: "Por exemplo: login e senha do sistema Drone Express. O usuário precisa inserir suas credenciais fictícias, como e-mail e senha, para acessar o sistema Drone Express. Como cliente, ele poderá dar início aos seus pedidos e acessar suas informações pessoais."
  },
  {
    section: "Requisitos e Histórias de Usuário",
    question: "Explique os critérios do acrônimo INVEST e por que eles são vitais para criar boas histórias de usuário.",
    answer: "Exemplo de História de Usuário: Como cliente do Drone Express, eu quero acompanhar minha entrega em tempo real, para saber quando meu pedido chegará. Essa história segue o INVEST porque: é independente; pode ser ajustada pela equipe; gera valor ao cliente; é possível estimar o desenvolvimento; é pequena e simples; e pode ser testada no sistema."
  },
  {
    section: "Requisitos e Histórias de Usuário",
    question: "Qual a utilidade prática dos Critérios de Aceitação para o time de desenvolvimento e para o cliente?",
    answer: "Os Critérios de Aceitação ajudam o time a entender o que deve ser desenvolvido e testado. Para o cliente, garantem que a funcionalidade será entregue da forma esperada. Exemplo: no Drone Express, o usuário só acessa o sistema com login e senha corretos."
  },
  {
    section: "Requisitos e Histórias de Usuário",
    question: "Discorra sobre a importância de identificar corretamente os Stakeholders primários e externos para o sucesso dos requisitos.",
    answer: "Identificar os Stakeholders corretamente ajuda a entender as necessidades do projeto, evitando erros e garantindo requisitos mais claros e eficientes."
  },
  {
    section: "Requisitos e Histórias de Usuário",
    question: "Quais os riscos de se esquecer um stakeholder importante durante a fase de levantamento de requisitos?",
    answer: "Esquecer um stakeholder importante pode causar requisitos incompletos, erros no sistema, retrabalho e insatisfação dos usuários, prejudicando o sucesso do projeto."
  },
  {
    section: "Estimativas e Refinamento",
    question: "Explique a técnica de Story Points e por que ela utiliza uma escala de estimativa relativa em vez de horas absolutas.",
    answer: "Story Points servem para estimar esforço e complexidade das tarefas. Eles usam estimativa relativa porque são mais flexíveis e precisos do que calcular horas exatas."
  },
  {
    section: "Estimativas e Refinamento",
    question: "Por que a sequência de Fibonacci é frequentemente adotada para evitar a falsa sensação de precisão em tarefas complexas?",
    answer: "A sequência de Fibonacci é usada porque mostra que tarefas maiores possuem mais incertezas e complexidade. Assim, evita passar uma falsa precisão nas estimativas e ajuda a equipe a avaliar melhor o esforço necessário."
  },
  {
    section: "Estimativas e Refinamento",
    question: "Detalhe o processo de Refinamento do Backlog (Grooming) e qual o nível de envolvimento necessário do Product Owner e dos Developers.",
    answer: "O Refinamento do Backlog serve para revisar e organizar as tarefas do projeto. O Product Owner define prioridades e os Developers analisam e estimam as atividades."
  },
  {
    section: "Estimativas e Refinamento",
    question: "Em que momento e com que objetivo o Planning Poker é utilizado dentro da rotina ágil?",
    answer: "O Planning Poker é utilizado durante o planejamento das tarefas para estimar o esforço das atividades. Seu objetivo é ajudar a equipe a chegar a uma estimativa em conjunto, promovendo discussão e alinhamento entre os membros."
  },
  {
    section: "Estimativas e Refinamento",
    question: "Analise por que a estimativa em Story Points não deve ser usada para comparar a produtividade individual de programadores.",
    answer: "Story Points não devem ser usados para comparar programadores porque medem o esforço da equipe e não o desempenho individual. Cada tarefa possui dificuldades diferentes, e o trabalho em equipe é o foco do método ágil."
  },
  {
    section: "Qualidade: DoR e DoD",
    question: "Defina a Definition of Ready (DoR) e explique como ela serve como um guia para que o trabalho comece com clareza.",
    answer: "A Definition of Ready (DoR) é um conjunto de critérios que define quando uma tarefa está pronta para começar o desenvolvimento. Ela serve como guia para garantir que a equipe tenha informações claras, requisitos definidos e entendimento da atividade antes de iniciar o trabalho."
  },
  {
    section: "Qualidade: DoR e DoD",
    question: "O que é a Definition of Done (DoD) e como ela garante que o incremento seja entregue com qualidade consistente?",
    answer: "A Definition of Done define quando uma tarefa está realmente concluída, garantindo que ela foi desenvolvida e testada com qualidade antes da entrega."
  },
  {
    section: "Qualidade: DoR e DoD",
    question: "Compare o DoR e o DoD, indicando em que ponto da Sprint cada um é aplicado e qual a pergunta principal que cada um responde.",
    answer: "O DoR (Definition of Ready) é usado antes do desenvolvimento e responde: A tarefa está pronta para começar? Já o DoD (Definition of Done) é usado no final e responde: A tarefa está pronta para subir/entregar com qualidade?"
  },
  {
    section: "Modelagem UML",
    question: "Explique o foco principal do Diagrama de Caso de Uso na documentação de requisitos funcionais.",
    answer: "O foco principal do Diagrama de Caso de Uso é mostrar como os usuários interagem com o sistema e quais funcionalidades podem ser realizadas. Ele ajuda a documentar os requisitos funcionais de forma clara e organizada."
  },
  {
    section: "Modelagem UML",
    question: "Como o Diagrama de Sequência auxilia na compreensão do comportamento temporal e das interações entre objetos do sistema?",
    answer: "O Diagrama de Sequência ajuda a entender a ordem das ações e a comunicação entre os objetos do sistema ao longo do tempo, mostrando como cada interação acontece durante a execução de uma funcionalidade."
  },
  {
    section: "Modelagem UML",
    question: "Discuta a aplicação da UML tanto em processos tradicionais (Cascata) quanto em contextos ágeis, desmistificando sua exclusividade.",
    answer: "A UML pode ser utilizada tanto no modelo Cascata quanto em métodos ágeis, ajudando na visualização e documentação do sistema."
  },
  {
    section: "Comparação e Filosofia de Trabalho",
    question: "Explique por que as mudanças de requisitos costumam ser vistas como problemas no modelo Cascata, mas são bem-vindas no Ágil.",
    answer: "No Cascata, mudanças causam problemas por causa do planejamento fixo. No Ágil, mudanças são aceitas para melhorar o projeto conforme a necessidade do cliente."
  },
  {
    section: "Comparação e Filosofia de Trabalho",
    question: "Como a transparência dos artefatos do Scrum auxilia na mitigação de riscos técnicos e de negócio?",
    answer: "A transparência dos artefatos do Scrum ajuda a identificar problemas e riscos mais rapidamente, permitindo melhor acompanhamento do projeto e tomada de decisões para evitar falhas técnicas e de negócio."
  },
  {
    section: "Comparação e Filosofia de Trabalho",
    question: "De que forma o sucesso de um projeto ágil é medido, comparando-o com as métricas tradicionais de cronograma e documentação?",
    answer: "No Ágil, o sucesso do projeto é medido pela entrega de valor, satisfação do cliente e funcionamento do sistema. Já nas métricas tradicionais, o foco costuma ser cumprir cronograma, custo e documentação planejada."
  },
  {
    section: "Artefatos e Eventos Scrum",
    question: "Defina o Product Backlog e explique por que ele é considerado um \"artefato vivo\" em constante evolução.",
    answer: "O Product Backlog é a lista de tarefas, funcionalidades e requisitos do projeto. Ele é considerado um \"artefato vivo\" porque pode ser atualizado e ajustado constantemente conforme as necessidades do cliente e do projeto mudam."
  },
  {
    section: "Artefatos e Eventos Scrum",
    question: "Descreva a dinâmica da Sprint Planning e quais são os principais resultados esperados deste evento.",
    answer: "A Sprint Planning é a reunião de planejamento da Sprint, onde a equipe define as tarefas e objetivos que serão realizados durante o período."
  },
  {
    section: "Artefatos e Eventos Scrum",
    question: "Qual a função da Daily Scrum para a inspeção e adaptação do progresso em direção à Meta da Sprint?",
    answer: "A Daily Scrum serve para acompanhar o progresso da Sprint, identificar problemas e ajustar o trabalho da equipe para alcançar a Meta da Sprint."
  },
  {
    section: "Artefatos e Eventos Scrum",
    question: "Diferencie os objetivos e os participantes de uma Sprint Review em comparação com uma Sprint Retrospective.",
    answer: "A Sprint Review é realizada para apresentar o que foi desenvolvido e receber feedback do cliente e stakeholders. Já a Sprint Retrospective é feita apenas pela equipe para analisar melhorias no processo e no trabalho realizado."
  },
  {
    section: "Artefatos e Eventos Scrum",
    question: "Explique o que constitui um Incremento de software e qual o nível de qualidade esperado dele ao final de cada iteração.",
    answer: "O Incremento de software é a parte funcional do sistema desenvolvida durante a Sprint. Ao final de cada iteração, ele deve estar funcionando, testado e com qualidade suficiente para ser entregue ou utilizado."
  },
  {
    section: "Artefatos e Eventos Scrum",
    question: "Como o feedback recebido dos stakeholders na Sprint Review pode impactar o planejamento futuro do produto?",
    answer: "O feedback dos stakeholders na Sprint Review ajuda a identificar melhorias, corrigir problemas e ajustar prioridades, influenciando o planejamento das próximas funcionalidades do produto."
  }
];

export function ensureSoftwareQuizSeed(db) {
  const saveForUser = db.transaction((userId) => {
    const subjectId = ensureSubject(db, userId);
    const existingTopics = db
      .prepare("SELECT id, title FROM topics WHERE subject_id = ?")
      .all(subjectId);
    const existingByTitle = new Map(existingTopics.map((topic) => [topic.title, topic.id]));

    const insertTopic = db.prepare(`
      INSERT INTO topics (
        subject_id, title, summary, difficulty, exam_weight, previous_frequency,
        class_emphasis, student_confidence, status, next_review_at, notes, questions
      ) VALUES (?, ?, ?, 5, 5, 8, 5, 1, 'Revisar', ?, ?, ?)
    `);
    const updateTopic = db.prepare(`
      UPDATE topics
      SET summary = ?, difficulty = 5, exam_weight = 5, previous_frequency = 8,
          class_emphasis = 5, student_confidence = 1, status = 'Revisar',
          next_review_at = ?, notes = ?, questions = ?
      WHERE id = ?
    `);

    for (const [index, item] of QUIZ_ITEMS.entries()) {
      const title = titleFor(index + 1, item.question);
      const notes = `${SOFTWARE_QUIZ_MARKER}\nTema: ${item.section}`;
      const questions = JSON.stringify([{ question: item.question, answer: item.answer }]);
      const existingId = existingByTitle.get(title);

      if (existingId) {
        updateTopic.run(item.answer, dueDate(), notes, questions, existingId);
      } else {
        insertTopic.run(subjectId, title, item.answer, dueDate(), notes, questions);
      }
    }
  });

  for (const userId of SEEDED_USER_IDS) {
    saveForUser(userId);
  }
}

function ensureSubject(db, userId) {
  const existing = db
    .prepare("SELECT id FROM subjects WHERE user_id = ? AND name = ?")
    .get(userId, SUBJECT_NAME);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO subjects (user_id, name, professor, weight, difficulty, desired_hours)
    VALUES (?, ?, 'Mariana', 3, 3, 6)
  `).run(userId, SUBJECT_NAME);
  return result.lastInsertRowid;
}

function titleFor(number, question) {
  const shortQuestion = question
    .replace(/[?!.:;,]+$/g, "")
    .slice(0, 72)
    .trim();
  return `Quiz Eng. Software ${String(number).padStart(2, "0")} - ${shortQuestion}`;
}

function dueDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

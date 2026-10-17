import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {
  assertLocalTestDatabase,
  postgresConnectionOptions,
  testPostgresConnectionOptions,
} from '../src/postgres-connection.mjs';

const { Client } = pg;
const useTestDatabase = process.argv.includes('--test');
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
if (useTestDatabase) {
  dotenv.config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)), override: true });
}
let client;

const roleDefinitions = [
  { slug: 'candidate', name: 'Candidate' },
  { slug: 'recruiter', name: 'Recruiter' },
  { slug: 'placement_officer', name: 'Placement Officer' },
  { slug: 'mentor', name: 'Mentor' },
  { slug: 'super_admin', name: 'Super Admin' },
];

const permissionDefinitions = {
  candidate: {
    profiles: ['create', 'read', 'update', 'delete'], resumes: ['create', 'read', 'update', 'delete'],
    resume_analyses: ['create', 'read'], role_fit_results: ['read'], assessments: ['read'],
    assessment_attempts: ['create', 'read', 'update'], interview_sessions: ['create', 'read', 'update'],
    jobs: ['read'], applications: ['create', 'read'], placement_probability_snapshots: ['read'],
    notifications: ['read', 'update'], consent_records: ['create', 'read', 'update'],
  },
  recruiter: {
    profiles: ['create', 'read', 'update', 'delete'], company_profiles: ['create', 'read', 'update'],
    jobs: ['create', 'read', 'update', 'delete'], applications: ['read', 'update'],
    assessments: ['create', 'read', 'update', 'delete'], questions: ['create', 'read', 'update'],
    interview_schedules: ['create', 'read', 'update', 'delete'], notifications: ['read', 'update'],
  },
  placement_officer: {
    profiles: ['create', 'read', 'update', 'delete'], institutions: ['read', 'update'], batches: ['create', 'read', 'update', 'delete'],
    resumes: ['read'], resume_analyses: ['read'], role_fit_results: ['read'], assessments: ['create', 'read', 'update'],
    assessment_assignments: ['create', 'read', 'update', 'delete'], interview_sessions: ['read'], jobs: ['read'], applications: ['read'],
  },
  mentor: {
    profiles: ['create', 'read', 'update', 'delete'], resumes: ['read'], resume_analyses: ['read'],
    interview_sessions: ['read', 'update'], interview_evaluations: ['create', 'read', 'update'], roadmap_tasks: ['create', 'read', 'update'],
  },
  super_admin: {
    users: ['create', 'read', 'update', 'delete'], roles: ['create', 'read', 'update', 'delete'],
    permissions: ['create', 'read', 'update', 'delete'], institutions: ['create', 'read', 'update', 'delete'],
    company_profiles: ['create', 'read', 'update', 'delete'], resumes: ['read'], resume_analyses: ['read'],
    role_catalog: ['create', 'read', 'update', 'delete'], skills: ['create', 'read', 'update', 'delete'],
    questions: ['create', 'read', 'update', 'delete'], assessments: ['create', 'read', 'update', 'delete'],
    jobs: ['create', 'read', 'update', 'delete'], placement_probability_snapshots: ['read'],
    scoring_weight_sets: ['create', 'read', 'update', 'delete'], audit_logs: ['read'], feature_flags: ['create', 'read', 'update', 'delete'],
  },
};

const catalogRoles = [
  { slug: 'software-engineer', name: 'Software Engineer', description: 'Build, test, and maintain software applications.', skills: ['Programming', 'Data Structures', 'Algorithms', 'Git', 'SQL'] },
  { slug: 'frontend-developer', name: 'Frontend Developer', description: 'Build accessible, responsive web interfaces.', skills: ['JavaScript', 'React', 'Programming', 'Git', 'Communication'] },
  { slug: 'backend-developer', name: 'Backend Developer', description: 'Build APIs, services, and data-backed systems.', skills: ['Programming', 'SQL', 'Node.js', 'Data Structures', 'Git'] },
  { slug: 'data-analyst', name: 'Data Analyst', description: 'Turn data into reliable analysis and useful decisions.', skills: ['SQL', 'Python', 'Statistics', 'Data Visualization', 'Communication'] },
  { slug: 'data-scientist', name: 'Data Scientist', description: 'Use statistics and machine learning to answer complex questions.', skills: ['Python', 'Statistics', 'Machine Learning', 'SQL', 'Data Visualization'] },
  { slug: 'devops-engineer', name: 'DevOps Engineer', description: 'Automate reliable software delivery and cloud operations.', skills: ['Docker', 'Cloud Computing', 'Programming', 'Linux', 'Git'] },
  { slug: 'cybersecurity-analyst', name: 'Cybersecurity Analyst', description: 'Identify security risks and protect systems and data.', skills: ['Cybersecurity', 'Linux', 'Programming', 'Networking', 'Communication'] },
  { slug: 'qa-engineer', name: 'QA Engineer', description: 'Design and execute tests to improve software quality.', skills: ['Testing', 'Automation', 'Programming', 'Git', 'Communication'] },
];

const skills = [
  ['Programming', 'language'], ['Data Structures', 'computer_science'], ['Algorithms', 'computer_science'],
  ['Git', 'tool'], ['SQL', 'database'], ['Python', 'language'], ['Statistics', 'analytics'],
  ['Data Visualization', 'analytics'], ['Communication', 'soft_skill'], ['Testing', 'quality'], ['Automation', 'quality'],
  ['JavaScript', 'language'], ['React', 'framework'], ['Node.js', 'framework'], ['Machine Learning', 'analytics'],
  ['Docker', 'tool'], ['Cloud Computing', 'tool'], ['Linux', 'tool'], ['Cybersecurity', 'computer_science'], ['Networking', 'computer_science'],
];

const learningResources = [
  ['Programming', 'freeCodeCamp Curriculum', 'https://www.freecodecamp.org/learn/', 'freeCodeCamp'],
  ['Data Structures', 'Visualizing Data Structures and Algorithms', 'https://visualgo.net/en', 'VisuAlgo'],
  ['Algorithms', 'Algorithms course', 'https://www.khanacademy.org/computing/computer-science/algorithms', 'Khan Academy'],
  ['Git', 'Pro Git Book', 'https://git-scm.com/book/en/v2', 'Git'],
  ['SQL', 'SQLBolt Interactive Lessons', 'https://sqlbolt.com/', 'SQLBolt'],
  ['Python', 'The Python Tutorial', 'https://docs.python.org/3/tutorial/', 'Python Software Foundation'],
  ['Statistics', 'OpenIntro Statistics', 'https://www.openintro.org/book/os/', 'OpenIntro'],
  ['Data Visualization', 'From Data to Viz', 'https://www.data-to-viz.com/', 'From Data to Viz'],
  ['Communication', 'Toastmasters Public Speaking Tips', 'https://www.toastmasters.org/resources/public-speaking-tips', 'Toastmasters'],
  ['Testing', 'Playwright Documentation', 'https://playwright.dev/docs/intro', 'Playwright'],
  ['Automation', 'Playwright Documentation', 'https://playwright.dev/docs/intro', 'Playwright'],
];

const questions = [
  ['technical_mcq', 'Data Structures', 'arrays', 'easy', 'What is the time complexity of accessing an array element by index?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 0, 'Array indexing uses a direct offset from the base address.'],
  ['technical_mcq', 'Data Structures', 'stacks', 'easy', 'Which operation removes the most recently added item from a stack?', ['Dequeue', 'Pop', 'Peek', 'Sort'], 1, 'A stack follows last-in, first-out order; pop removes its top item.'],
  ['technical_mcq', 'Data Structures', 'queues', 'easy', 'Which ordering rule does a standard queue follow?', ['Last-in, first-out', 'First-in, first-out', 'Random access', 'Sorted order'], 1, 'A queue removes items in the order they were added.'],
  ['technical_mcq', 'Data Structures', 'hash tables', 'medium', 'What is the average-case lookup time for a well-distributed hash table?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 0, 'Hashing maps a key to a bucket in constant expected time.'],
  ['technical_mcq', 'Databases', 'sql', 'easy', 'Which SQL clause filters rows before grouping?', ['HAVING', 'ORDER BY', 'WHERE', 'LIMIT'], 2, 'WHERE filters input rows before GROUP BY is applied.'],
  ['technical_mcq', 'Databases', 'sql', 'easy', 'Which SQL join returns only rows with matching keys in both tables?', ['LEFT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN'], 1, 'INNER JOIN keeps rows that satisfy the join condition on both sides.'],
  ['technical_mcq', 'Databases', 'transactions', 'medium', 'Which ACID property ensures committed data survives a system failure?', ['Atomicity', 'Consistency', 'Isolation', 'Durability'], 3, 'Durability means committed transaction changes persist.'],
  ['technical_mcq', 'Databases', 'normalization', 'medium', 'What is a primary goal of database normalization?', ['Increase duplicate data', 'Reduce update anomalies', 'Remove all indexes', 'Store every value as text'], 1, 'Normalization organizes data to reduce redundancy and modification anomalies.'],
  ['technical_mcq', 'Object-Oriented Programming', 'polymorphism', 'easy', 'What does method overriding allow a subclass to do?', ['Change a superclass method implementation', 'Create a database index', 'Prevent object creation', 'Delete a parent class'], 0, 'Overriding supplies a subclass-specific implementation of an inherited method.'],
  ['technical_mcq', 'Object-Oriented Programming', 'encapsulation', 'easy', 'Which concept bundles state with methods and controls access to that state?', ['Inheritance', 'Encapsulation', 'Compilation', 'Recursion'], 1, 'Encapsulation groups data and behavior behind a controlled interface.'],
  ['technical_mcq', 'Object-Oriented Programming', 'inheritance', 'easy', 'What is inheritance primarily used to express in object-oriented programming?', ['A subtype relationship', 'A network connection', 'A sorting order', 'A database transaction'], 0, 'Inheritance lets a subtype reuse or extend behavior from a base type.'],
  ['technical_mcq', 'Object-Oriented Programming', 'interfaces', 'medium', 'What does an interface primarily define?', ['A contract of operations', 'An object memory address', 'A database row', 'A runtime thread'], 0, 'An interface describes operations that implementing types agree to provide.'],
  ['technical_mcq', 'Operating Systems', 'processes', 'easy', 'What is a process?', ['A program currently executing', 'A file extension', 'A network protocol', 'A database schema'], 0, 'A process is an instance of a program in execution.'],
  ['technical_mcq', 'Operating Systems', 'synchronization', 'medium', 'What can a mutex help prevent when threads share mutable data?', ['Race conditions', 'Page faults', 'Compilation errors', 'DNS failures'], 0, 'A mutex provides mutual exclusion around a critical section.'],
  ['technical_mcq', 'Operating Systems', 'memory', 'medium', 'What is virtual memory used for?', ['Presenting processes with an isolated address space', 'Encrypting network packets', 'Sorting files', 'Scheduling database queries'], 0, 'Virtual memory maps process addresses to physical memory and storage.'],
  ['technical_mcq', 'Operating Systems', 'deadlocks', 'medium', 'Which condition is required for a deadlock?', ['Circular wait', 'Compression', 'Caching', 'Preemption only'], 0, 'Circular wait is one of the four Coffman conditions for deadlock.'],
  ['technical_mcq', 'Computer Networks', 'http', 'easy', 'Which protocol is commonly used to transfer web pages?', ['HTTP', 'FTP only', 'SMTP', 'SSH'], 0, 'HTTP is the application protocol used by web clients and servers.'],
  ['technical_mcq', 'Computer Networks', 'dns', 'easy', 'What does DNS primarily translate?', ['Domain names to IP addresses', 'Files to packets', 'Passwords to hashes', 'Ports to processes'], 0, 'DNS resolves human-readable domain names to network records such as IP addresses.'],
  ['technical_mcq', 'Computer Networks', 'tcp', 'medium', 'Which TCP feature provides ordered, reliable byte delivery?', ['Acknowledgments and retransmissions', 'Broadcast-only delivery', 'No connection state', 'Fixed-size files'], 0, 'TCP uses sequence numbers, acknowledgments, and retransmissions to provide reliable ordered delivery.'],
  ['technical_mcq', 'Computer Networks', 'tls', 'medium', 'What security property does TLS provide for data in transit?', ['Confidentiality and integrity', 'Database normalization', 'CPU scheduling', 'File compression'], 0, 'TLS encrypts transport and authenticates integrity, with peer authentication depending on configuration.'],
];

const generatedQuestions = [];
const vocabulary = [
  ['abundant', 'plentiful', 'scarce'], ['accurate', 'precise', 'uncertain'], ['adapt', 'adjust', 'resist'],
  ['brief', 'concise', 'lengthy'], ['cautious', 'careful', 'reckless'], ['complex', 'intricate', 'simple'],
  ['confirm', 'verify', 'dispute'], ['decline', 'decrease', 'increase'], ['essential', 'necessary', 'optional'],
  ['expand', 'enlarge', 'shrink'], ['frequent', 'regular', 'rare'], ['genuine', 'authentic', 'artificial'],
  ['hinder', 'obstruct', 'assist'], ['improve', 'enhance', 'worsen'], ['initial', 'beginning', 'final'],
  ['maintain', 'preserve', 'abandon'], ['obvious', 'evident', 'hidden'], ['rapid', 'swift', 'slow'],
  ['reliable', 'dependable', 'untrustworthy'], ['select', 'choose', 'reject'],
];

for (let index = 1; index <= 20; index += 1) {
  const totalQuestions = 100 + index * 10;
  const percent = 20 + (index % 7) * 10;
  const answer = (totalQuestions * percent) / 100;
  generatedQuestions.push([
    'aptitude', 'Quantitative Aptitude', 'percentages', 'easy',
    `A practice set has ${totalQuestions} questions. What is ${percent}% of the set?`,
    [String(answer), String(answer + 2), String(answer - 2), String(answer + 5)], 0,
    `${percent}% of ${totalQuestions} is ${answer}.`,
  ]);

  const firstTerm = index + 2;
  const difference = (index % 8) + 2;
  const sequence = [0, 1, 2, 3].map((step) => firstTerm + difference * step);
  const nextTerm = firstTerm + difference * 4;
  generatedQuestions.push([
    'aptitude', 'Logical Reasoning', 'number series', 'easy',
    `What number comes next in this sequence: ${sequence.join(', ')}, ...?`,
    [String(nextTerm), String(nextTerm + difference), String(nextTerm - 1), String(nextTerm * 2)], 0,
    `Each term increases by ${difference}, so the next term is ${nextTerm}.`,
  ]);

  const left = index * 3 + 4;
  const right = index + 7;
  generatedQuestions.push([
    'technical_mcq', 'Programming', 'expression evaluation', 'easy',
    `A program sets value = ${left}, then adds ${right} to value. What is value afterward?`,
    [String(left + right), String(left * right), String(left - right), String(left + right + 1)], 0,
    `Adding ${right} to ${left} produces ${left + right}.`,
  ]);

  const [word, synonym, antonym] = vocabulary[index - 1];
  generatedQuestions.push([
    'aptitude', 'Verbal Reasoning', 'vocabulary', 'easy',
    `Which option is closest in meaning to "${word}"?`,
    [synonym, antonym, 'unrelated', 'unclear'], 0,
    `"${synonym}" is a synonym of "${word}".`,
  ]);
}

async function seed() {
  const connection = useTestDatabase
    ? testPostgresConnectionOptions(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST)
    : postgresConnectionOptions(process.env.DATABASE_URL);
  if (useTestDatabase) {
    const target = assertLocalTestDatabase(process.env.DATABASE_URL_TEST, process.env.ALLOW_REMOTE_TEST_DB === 'true');
    console.info('Test database target:', target);
  }
  client = new Client(connection);
  await client.connect();
  await client.query('BEGIN');

  const roleIds = new Map();
  for (const role of roleDefinitions) {
    const result = await client.query(
      'INSERT INTO roles (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id',
      [role.slug, role.name],
    );
    roleIds.set(role.slug, result.rows[0].id);
  }

  const permissionIds = new Map();
  for (const grants of Object.values(permissionDefinitions)) {
    for (const [resource, actions] of Object.entries(grants)) {
      for (const action of actions) {
        const result = await client.query(
          'INSERT INTO permissions (resource, action) VALUES ($1, $2) ON CONFLICT (resource, action) DO UPDATE SET resource = EXCLUDED.resource RETURNING id',
          [resource, action],
        );
        permissionIds.set(`${resource}:${action}`, result.rows[0].id);
      }
    }
  }

  for (const [slug, grants] of Object.entries(permissionDefinitions)) {
    for (const [resource, actions] of Object.entries(grants)) {
      for (const action of actions) {
        await client.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [roleIds.get(slug), permissionIds.get(`${resource}:${action}`)],
        );
      }
    }
  }

  const institution = await client.query(
    `INSERT INTO institutions (name, domain) VALUES ('PlacePrep Demo University', 'example.test')
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  let institutionId = institution.rows[0]?.id;
  if (!institutionId) {
    const existing = await client.query('SELECT id FROM institutions WHERE name = $1 LIMIT 1', ['PlacePrep Demo University']);
    institutionId = existing.rows[0].id;
  }
  const batchResult = await client.query(
    `INSERT INTO batches (institution_id, name, graduation_year, department)
     VALUES ($1, 'Class of 2026', 2026, 'Computer Science')
     ON CONFLICT (institution_id, name) DO UPDATE SET graduation_year = EXCLUDED.graduation_year RETURNING id`,
    [institutionId],
  );

  const seedPassword = process.env.SEED_USER_PASSWORD || 'PlacePrep-Dev-2026!';
  const passwordHash = await bcrypt.hash(seedPassword, 12);
  const seedUsers = new Map();
  for (const role of roleDefinitions) {
    for (let index = 1; index <= 5; index += 1) {
      const email = `${role.slug}.${index}@example.test`;
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, name, email_verified_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [email, passwordHash, `${role.name} ${index}`],
      );
      const userId = userResult.rows[0].id;
      seedUsers.set(`${role.slug}:${index}`, userId);
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, roleIds.get(role.slug)],
      );
      if (role.slug === 'candidate') {
        await client.query(
          `INSERT INTO candidate_profiles (user_id, institution_id, batch_id, degree, branch, graduation_year)
           VALUES ($1, $2, $3, 'B.Tech', 'Computer Science', 2026)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, institutionId, batchResult.rows[0].id],
        );
      }
    }
  }

  const skillIds = new Map();
  for (const [name, category] of skills) {
    const result = await client.query(
      'INSERT INTO skills (name, category) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category RETURNING id',
      [name, category],
    );
    skillIds.set(name, result.rows[0].id);
  }

  for (const [skill, title, url, provider] of learningResources) {
    await client.query(
      `INSERT INTO skill_resources (skill_id, title, url, provider, free, approved_at)
       VALUES ($1, $2, $3, $4, true, now()) ON CONFLICT (skill_id, url) DO NOTHING`,
      [skillIds.get(skill), title, url, provider],
    );
  }

  const roleCatalogIds = new Map();
  for (const role of catalogRoles) {
    const result = await client.query(
      `INSERT INTO role_catalog (slug, name, description, experience_level, assessment_types, interview_topics)
       VALUES ($1, $2, $3, 'entry', ARRAY['aptitude', 'technical_mcq', 'coding'], ARRAY['fundamentals', 'projects', 'problem_solving'])
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description RETURNING id`,
      [role.slug, role.name, role.description],
    );
    const roleId = result.rows[0].id;
    roleCatalogIds.set(role.slug, roleId);
    for (const [index, skill] of role.skills.entries()) {
      await client.query(
        `INSERT INTO role_skill_weights (role_id, skill_id, weight, must_have)
         VALUES ($1, $2, $3, $4) ON CONFLICT (role_id, skill_id) DO UPDATE SET weight = EXCLUDED.weight, must_have = EXCLUDED.must_have`,
        [roleId, skillIds.get(skill), 100 / role.skills.length, index < 3],
      );
    }
  }

  for (const [type, topic, subtopic, difficulty, prompt, options, answer, explanation] of [...questions, ...generatedQuestions]) {
    const existing = await client.query('SELECT id FROM questions WHERE prompt = $1 LIMIT 1', [prompt]);
    if (existing.rowCount) continue;
    await client.query(
      `INSERT INTO questions (question_type, topic, subtopic, difficulty, prompt, options, correct_answer, explanation, visibility, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'global', now())`,
      [type, topic, subtopic, difficulty, prompt, JSON.stringify(options), JSON.stringify({ index: answer }), explanation],
    );
  }

  const jobSeedData = [
    { company: 'Northstar Software', roleSlug: 'software-engineer', title: 'Graduate Software Engineer', description: 'Entry-level software role focused on building and testing web services.', skills: ['Programming', 'Data Structures', 'Git'], cgpa: 6.5, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 600000, packageMax: 900000, rounds: ['Online Test', 'Technical Interview', 'HR Round'] },
    { company: 'Greenfield Analytics', roleSlug: 'data-analyst', title: 'Junior Data Analyst', description: 'Entry-level analytics role focused on SQL, Python, and communicating data insights.', skills: ['SQL', 'Python', 'Data Visualization'], cgpa: 6.5, location: 'Hyderabad, India', expLevel: 'freshers', packageMin: 500000, packageMax: 800000, rounds: ['Aptitude Test', 'Case Study', 'HR Round'] },
    { company: 'TechCorp India', roleSlug: 'frontend-developer', title: 'Frontend Developer Trainee', description: 'Build responsive UIs using React and modern CSS.', skills: ['JavaScript', 'React', 'Git'], cgpa: 6.0, location: 'Pune, India', expLevel: 'freshers', packageMin: 550000, packageMax: 850000, rounds: ['Coding Round', 'Technical Interview', 'HR'] },
    { company: 'TechCorp India', roleSlug: 'backend-developer', title: 'Backend Engineer (Node.js)', description: 'Design and build REST APIs, work with PostgreSQL and Redis.', skills: ['Node.js', 'SQL', 'Programming'], cgpa: 6.5, location: 'Pune, India', expLevel: 'freshers', packageMin: 650000, packageMax: 1000000, rounds: ['DSA Round', 'System Design', 'HR'] },
    { company: 'Infosys', roleSlug: 'software-engineer', title: 'Systems Engineer', description: 'Work on enterprise software projects across domains. Training provided.', skills: ['Programming', 'Communication', 'Git'], cgpa: 6.0, location: 'Multiple Locations, India', expLevel: 'freshers', packageMin: 330000, packageMax: 380000, rounds: ['InfyTQ Test', 'Technical Interview', 'HR'] },
    { company: 'Wipro', roleSlug: 'software-engineer', title: 'Project Engineer', description: 'Develop and maintain software solutions for global clients.', skills: ['Programming', 'SQL', 'Communication'], cgpa: 6.0, location: 'Multiple Locations, India', expLevel: 'freshers', packageMin: 350000, packageMax: 400000, rounds: ['NLTH Test', 'Technical Interview', 'HR'] },
    { company: 'Tata Consultancy Services', roleSlug: 'software-engineer', title: 'Assistant System Engineer', description: 'Join TCS as a fresher and work on large-scale enterprise projects.', skills: ['Programming', 'Data Structures', 'Communication'], cgpa: 6.0, location: 'Pan India', expLevel: 'freshers', packageMin: 360000, packageMax: 420000, rounds: ['TCS NQT', 'Technical Interview', 'HR'] },
    { company: 'Accenture', roleSlug: 'software-engineer', title: 'Associate Software Engineer', description: 'Work on digital transformation projects for global clients.', skills: ['Programming', 'Communication', 'Git'], cgpa: 6.0, location: 'Bangalore / Mumbai, India', expLevel: 'freshers', packageMin: 450000, packageMax: 500000, rounds: ['Cognitive Test', 'Technical Interview', 'HR'] },
    { company: 'Amazon', roleSlug: 'software-engineer', title: 'SDE-1 (New Grad)', description: 'Build scalable distributed systems. Strong DSA and system design skills required.', skills: ['Algorithms', 'Data Structures', 'Programming'], cgpa: 7.0, location: 'Hyderabad / Bangalore, India', expLevel: 'freshers', packageMin: 2000000, packageMax: 3500000, rounds: ['OA Round', 'DSA Interview', 'Bar Raiser', 'Hiring Manager'] },
    { company: 'Google', roleSlug: 'software-engineer', title: 'Software Engineer (University Grad)', description: 'Work on Google-scale infrastructure and products.', skills: ['Algorithms', 'Data Structures', 'Programming'], cgpa: 7.5, location: 'Hyderabad, India', expLevel: 'freshers', packageMin: 3000000, packageMax: 5000000, rounds: ['Phone Screen', 'Onsite x4', 'Team Match'] },
    { company: 'Microsoft', roleSlug: 'software-engineer', title: 'Software Engineer II', description: 'Build products used by billions. Strong coding and design skills needed.', skills: ['Programming', 'Data Structures', 'Algorithms'], cgpa: 7.0, location: 'Hyderabad, India', expLevel: 'freshers', packageMin: 2500000, packageMax: 4000000, rounds: ['OA', 'Technical x3', 'HR'] },
    { company: 'Flipkart', roleSlug: 'software-engineer', title: 'SDE-1', description: 'Work on India largest e-commerce platform backend services.', skills: ['Programming', 'Data Structures', 'SQL'], cgpa: 7.0, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 1800000, packageMax: 2800000, rounds: ['Machine Coding', 'DSA', 'System Design', 'HR'] },
    { company: 'Zomato', roleSlug: 'backend-developer', title: 'Backend Engineer', description: 'Build high-throughput food delivery platform services.', skills: ['Programming', 'SQL', 'Node.js'], cgpa: 6.5, location: 'Gurugram, India', expLevel: 'freshers', packageMin: 1200000, packageMax: 2000000, rounds: ['Coding Test', 'Technical x2', 'Culture Fit'] },
    { company: 'Swiggy', roleSlug: 'backend-developer', title: 'Software Development Engineer', description: 'Scale backend systems for millions of daily orders.', skills: ['Programming', 'Data Structures', 'SQL'], cgpa: 6.5, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 1200000, packageMax: 2000000, rounds: ['OA', 'Technical x2', 'HR'] },
    { company: 'Razorpay', roleSlug: 'backend-developer', title: 'Software Engineer (Payments)', description: 'Build reliable payment infrastructure for India fintech ecosystem.', skills: ['Programming', 'SQL', 'Node.js'], cgpa: 7.0, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 1500000, packageMax: 2500000, rounds: ['Coding Round', 'System Design', 'Technical', 'HR'] },
    { company: 'CRED', roleSlug: 'frontend-developer', title: 'Frontend Engineer', description: 'Craft pixel-perfect performant UIs for CRED premium user base.', skills: ['JavaScript', 'React', 'Communication'], cgpa: 7.0, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 1400000, packageMax: 2200000, rounds: ['Take-home Assignment', 'Technical x2', 'Culture'] },
    { company: 'Meesho', roleSlug: 'data-analyst', title: 'Data Analyst', description: 'Analyze seller and buyer data to drive growth decisions.', skills: ['SQL', 'Python', 'Data Visualization'], cgpa: 6.5, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 900000, packageMax: 1400000, rounds: ['SQL Test', 'Case Study', 'HR'] },
    { company: 'PhonePe', roleSlug: 'data-scientist', title: 'Data Scientist', description: 'Build ML models for fraud detection and personalization.', skills: ['Python', 'Machine Learning', 'Statistics'], cgpa: 7.0, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 1600000, packageMax: 2600000, rounds: ['ML Test', 'Technical x2', 'HR'] },
    { company: 'Ola', roleSlug: 'devops-engineer', title: 'DevOps Engineer', description: 'Manage cloud infrastructure and CI/CD pipelines for Ola platform.', skills: ['Docker', 'Cloud Computing', 'Linux'], cgpa: 6.5, location: 'Bangalore, India', expLevel: 'freshers', packageMin: 1000000, packageMax: 1600000, rounds: ['Technical Test', 'DevOps Interview', 'HR'] },
    { company: 'HCL Technologies', roleSlug: 'qa-engineer', title: 'QA Engineer Trainee', description: 'Test enterprise software products and build automation frameworks.', skills: ['Testing', 'Automation', 'Communication'], cgpa: 6.0, location: 'Noida, India', expLevel: 'freshers', packageMin: 380000, packageMax: 450000, rounds: ['Aptitude Test', 'Technical Interview', 'HR'] },
    { company: 'Cognizant', roleSlug: 'software-engineer', title: 'Programmer Analyst Trainee', description: 'Join CTS and work on global client projects with training support.', skills: ['Programming', 'SQL', 'Communication'], cgpa: 6.0, location: 'Multiple Locations, India', expLevel: 'freshers', packageMin: 400000, packageMax: 450000, rounds: ['CCAT Test', 'Technical Interview', 'HR'] },
    { company: 'Capgemini', roleSlug: 'software-engineer', title: 'Analyst', description: 'Work on digital and cloud transformation projects.', skills: ['Programming', 'Communication', 'Git'], cgpa: 6.0, location: 'Multiple Locations, India', expLevel: 'freshers', packageMin: 380000, packageMax: 430000, rounds: ['Pseudo Code Test', 'Technical Interview', 'HR'] },
    { company: 'IBM India', roleSlug: 'devops-engineer', title: 'Associate DevOps Engineer', description: 'Work on IBM Cloud and hybrid cloud deployments for enterprise clients.', skills: ['Docker', 'Cloud Computing', 'Linux'], cgpa: 6.5, location: 'Bangalore / Pune, India', expLevel: 'freshers', packageMin: 500000, packageMax: 700000, rounds: ['Aptitude', 'Technical', 'HR'] },
    { company: 'Deloitte', roleSlug: 'data-analyst', title: 'Business Technology Analyst', description: 'Analyze business data and build dashboards for consulting clients.', skills: ['SQL', 'Data Visualization', 'Communication'], cgpa: 6.5, location: 'Multiple Locations, India', expLevel: 'freshers', packageMin: 700000, packageMax: 900000, rounds: ['Aptitude Test', 'Case Interview', 'HR'] },
    { company: 'EY', roleSlug: 'cybersecurity-analyst', title: 'Cybersecurity Analyst', description: 'Identify vulnerabilities and protect client systems and data.', skills: ['Cybersecurity', 'Networking', 'Communication'], cgpa: 6.5, location: 'Bangalore / Mumbai, India', expLevel: 'freshers', packageMin: 600000, packageMax: 900000, rounds: ['Technical Test', 'Security Interview', 'HR'] },
  ];

  const companyIdCache = new Map();
  const DUMMY_COMPANIES = ['Northstar Software', 'Greenfield Analytics'];
  for (let index = 0; index < companies.length; index += 1) {
    const companyName = companies[index];
    const companyResult = await client.query(
      `INSERT INTO company_profiles (name, website, verified_at)
       VALUES ($1, $2, now()) ON CONFLICT DO NOTHING RETURNING id`,
      [companyName, `https://example.test/company-${index + 1}`],
    );
    let companyId = companyResult.rows[0]?.id;
    if (!companyId) {
      const existing = await client.query('SELECT id FROM company_profiles WHERE name = $1 LIMIT 1', [companyName]);
      companyId = existing.rows[0].id;
    }
    await client.query(
      `INSERT INTO company_members (user_id, company_id, member_role)
       VALUES ($1, $2, 'admin') ON CONFLICT (user_id, company_id) DO NOTHING`,
      [seedUsers.get('recruiter:1'), companyId],
    );
    const roleSlug = index === 0 ? 'software-engineer' : 'data-analyst';
    const roleResult = await client.query('SELECT id FROM role_catalog WHERE slug = $1', [roleSlug]);
    const title = index === 0 ? 'Graduate Software Engineer' : 'Junior Data Analyst';
    const jobExists = await client.query('SELECT 1 FROM jobs WHERE company_id = $1 AND title = $2 LIMIT 1', [companyId, title]);
    if (!jobExists.rowCount) {
      await client.query(
        `INSERT INTO jobs (company_id, created_by, role_id, title, description, required_skills, minimum_cgpa, location, status, experience_level)
         VALUES ($1, $2, $3, $4, $5, $6, 6.5, 'India', 'open', 'freshers')`,
        [
          companyId,
          seedUsers.get('recruiter:1'),
          roleResult.rows[0]?.id ?? null,
          title,
          index === 0 ? 'Entry-level software role focused on building and testing web services.' : 'Entry-level analytics role focused on SQL, Python, and communicating data insights.',
          JSON.stringify(index === 0 ? ['Programming', 'Data Structures', 'Git'] : ['SQL', 'Python', 'Data Visualization']),
        ],
      );
    } else if (roleResult.rowCount) {
      await client.query(
        "UPDATE jobs SET role_id = COALESCE(role_id, $3), experience_level = 'freshers' WHERE company_id = $1 AND title = $2",
        [companyId, title, roleResult.rows[0].id],
      );
    }
  }

  const seededTest = await client.query(
    'SELECT id FROM assessments WHERE creator_id = $1 AND title = $2 LIMIT 1',
    [seedUsers.get('super_admin:1'), 'PlacePrep Core Skills Check'],
  );
  if (!seededTest.rowCount) {
    const sampleQuestions = await client.query(
      'SELECT id FROM questions WHERE visibility = $1 ORDER BY created_at, id LIMIT 20',
      ['global'],
    );
    const assessment = await client.query(
      `INSERT INTO assessments (
        creator_id, title, description, duration_seconds, passing_score,
        attempt_limit, randomized, published, visibility
      ) VALUES ($1, 'PlacePrep Core Skills Check', 'A short local practice assessment across aptitude and computing fundamentals.', 1800, 60, 3, true, true, 'global')
      RETURNING id`,
      [seedUsers.get('super_admin:1')],
    );
    await client.query(
      `INSERT INTO assessment_sections (assessment_id, title, position, duration_seconds, passing_score, question_ids)
       VALUES ($1, 'Core skills', 0, 1800, 60, $2)`,
      [assessment.rows[0].id, sampleQuestions.rows.map((row) => row.id)],
    );
  }

  await client.query('COMMIT');
  console.info('Seeded five users per role, three role profiles, 100 sample questions, one practice assessment, and two jobs.');
  console.info('Set SEED_USER_PASSWORD to choose a local development account password.');
}

try {
  await seed();
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Database seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
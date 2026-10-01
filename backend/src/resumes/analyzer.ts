export type ParsedResume = {
  contact?: { email?: string | null; phone?: string | null };
  summary?: string;
  education?: string;
  skills?: Record<string, string[]>;
  projects?: string[];
  experience?: string[];
  certifications?: string[];
  achievements?: string[];
  rawSections?: Record<string, string>;
  metadata?: { pageCount?: number; readable?: boolean; warnings?: string[] };
};

export type ResumeIssue = {
  severity: 'critical' | 'important' | 'nice_to_have';
  category: string;
  issue: string;
  whyItMatters: string;
  location: string;
  suggestedFix: string;
  beforeText: string | null;
  afterText: string | null;
  evidence: Record<string, unknown>;
};

export type RoleRequirement = { id: string; name: string; skills: Array<{ name: string; weight: number; mustHave: boolean }> };

export type RoleFit = {
  roleId: string;
  roleName: string;
  score: number;
  classification: 'Apply now' | 'Apply after small upskilling' | 'Not yet';
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string;
};

export type ResumeAnalysis = {
  score: number;
  subScores: Record<string, number>;
  verdict: 'READY TO APPLY' | 'ALMOST READY - MINOR FIXES' | 'NEEDS IMPROVEMENT' | 'NOT READY - MAJOR REWORK';
  criticalIssue: boolean;
  issues: ResumeIssue[];
  roleMatches: RoleFit[];
  modelVersion: 'rules-1';
};

const actionVerbPattern = /\b(built|created|developed|designed|improved|implemented|automated|analyzed|led|launched|reduced|increased|delivered|optimized|deployed|tested)\b/gi;
const measurablePattern = /\b\d+(?:\.\d+)?\s*(?:%|percent|users|customers|hours|days|weeks|months|x|ms|seconds|records|requests)\b/gi;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function allResumeSkills(resume: ParsedResume): string[] {
  return Object.values(resume.skills ?? {}).flat().map((skill) => skill.toLowerCase().trim()).filter(Boolean);
}

function matchRole(resume: ParsedResume, role: RoleRequirement): RoleFit {
  const candidateSkills = new Set(allResumeSkills(resume));
  const normalizedProjects = (resume.projects ?? []).join(' ').toLowerCase();
  const totalWeight = role.skills.reduce((sum, skill) => sum + skill.weight, 0) || 1;
  const matched = role.skills.filter((skill) => candidateSkills.has(skill.name.toLowerCase()));
  const missing = role.skills.filter((skill) => !candidateSkills.has(skill.name.toLowerCase()));
  const matchedWeight = matched.reduce((sum, skill) => sum + skill.weight, 0);
  const projectEvidence = matched.filter((skill) => normalizedProjects.includes(skill.name.toLowerCase())).length;
  const projectScore = role.skills.length ? projectEvidence / role.skills.length : 0;
  const score = clampScore((matchedWeight / totalWeight) * 80 + projectScore * 20);
  const classification = score >= 75 ? 'Apply now' : score >= 55 ? 'Apply after small upskilling' : 'Not yet';
  const requiredMatched = matched.filter((skill) => skill.mustHave).length;
  const requiredTotal = role.skills.filter((skill) => skill.mustHave).length;
  const missingNames = missing.slice(0, 4).map((skill) => skill.name);
  const explanation = `You match ${requiredMatched}/${requiredTotal} listed must-have skills${missingNames.length ? `; missing: ${missingNames.join(', ')}` : ''}. Project evidence contributes ${Math.round(projectScore * 20)} points.`;

  return {
    roleId: role.id,
    roleName: role.name,
    score,
    classification,
    matchedSkills: matched.map((skill) => skill.name),
    missingSkills: missing.map((skill) => skill.name),
    explanation,
  };
}

function issue(
  severity: ResumeIssue['severity'],
  category: string,
  title: string,
  whyItMatters: string,
  location: string,
  suggestedFix: string,
  beforeText: string | null = null,
  afterText: string | null = null,
  evidence: Record<string, unknown> = {},
): ResumeIssue {
  return { severity, category, issue: title, whyItMatters, location, suggestedFix, beforeText, afterText, evidence };
}

export function analyzeResume(
  resume: ParsedResume,
  roles: RoleRequirement[] = [],
  profile: { cgpa?: number | null; internships?: number } = {},
): ResumeAnalysis {
  const skills = allResumeSkills(resume);
  const projects = resume.projects ?? [];
  const experience = resume.experience ?? [];
  const allBullets = [...projects, ...experience].join('\n');
  const verbs = [...allBullets.matchAll(actionVerbPattern)].length;
  const metrics = [...allBullets.matchAll(measurablePattern)].length;
  const readable = resume.metadata?.readable ?? Boolean((resume.rawSections && Object.values(resume.rawSections).join('').length > 100));
  const hasProjectsOrExperience = projects.length > 0 || experience.length > 0;
  const subScores = {
    atsCompatibility: clampScore((readable ? 50 : 0) + (resume.contact?.email ? 30 : 0) + (resume.contact?.phone ? 10 : 0) + (resume.rawSections && Object.values(resume.rawSections).some(Boolean) ? 10 : 0)),
    formatStructure: clampScore(resume.metadata?.pageCount ? (resume.metadata.pageCount <= 1 ? 95 : resume.metadata.pageCount <= 2 ? 90 : resume.metadata.pageCount <= 3 ? 70 : 40) : 70),
    contentQuality: clampScore(40 + Math.min(30, verbs * 8) + Math.min(30, metrics * 10)),
    projectQuality: clampScore(Math.min(100, projects.length * 25 + (projects.some((project) => /https?:\/\//i.test(project)) ? 15 : 0) + Math.min(35, metrics * 10))),
    skillsRelevance: 65,
    placementRelevance: clampScore(40 + (profile.cgpa !== null && profile.cgpa !== undefined ? profile.cgpa * 4 : 10) + Math.min(20, (profile.internships ?? 0) * 10) + Math.min(10, skills.length * 2)),
    consistencyCredibility: clampScore(75 + (resume.contact?.email ? 10 : 0) + (resume.contact?.phone ? 5 : 0)),
  };
  const matches = roles.map((role) => matchRole(resume, role)).sort((left, right) => right.score - left.score);
  const targetSkills = roles[0]?.skills ?? [];
  if (targetSkills.length) {
    const targetedMatches = targetSkills.filter((skill) => skills.includes(skill.name.toLowerCase())).length;
    subScores.skillsRelevance = clampScore((targetedMatches / targetSkills.length) * 100);
  }

  const issues: ResumeIssue[] = [];
  if (!readable) {
    issues.push(issue('critical', 'ats_compatibility', 'Resume text could not be read by ATS.', 'Recruiters may receive an empty or incomplete resume when automated screening parses it.', 'Entire document', 'Upload a text-readable PDF or DOCX. If this is a scanned document, re-scan at a higher resolution.', null, null, { rule: 'parsed character count must be at least 100' }));
  }
  if (!resume.contact?.email) {
    issues.push(issue('critical', 'contact_information', 'No email address was detected.', 'Recruiters need a reliable way to contact you about interviews and offers.', 'Contact information', 'Add a professional email address near the top of the resume.', null, null, { rule: 'email pattern not found in parsed text' }));
  }
  if (!hasProjectsOrExperience) {
    issues.push(issue('critical', 'project_quality', 'No projects or experience were detected.', 'Hiring teams need evidence that you can apply your skills to practical work.', 'Projects and experience sections', 'Add at least one project or relevant experience entry with your contribution and tools used.', null, null, { rule: 'both parsed project and experience lists are empty' }));
  }
  if ((resume.metadata?.pageCount ?? 0) > 3) {
    issues.push(issue('important', 'format_structure', 'Resume exceeds three pages.', 'Long resumes make key placement evidence harder to scan.', 'Entire document', 'Prioritize the most relevant education, skills, projects, and experience; aim for one page as a fresher.', `${resume.metadata?.pageCount} pages`, 'Suggested - verify accuracy before using: condense older or less relevant details.'));
  }
  if (projects.length && metrics === 0) {
    issues.push(issue('important', 'content_quality', 'Project bullets do not show measurable outcomes.', 'Specific evidence makes your individual contribution easier to evaluate.', 'Projects section', 'Add a truthful metric such as scale, time saved, test coverage, or users reached. Do not invent numbers.', 'Built a project using the listed technologies.', 'Suggested - verify accuracy before using: Built a project using [technology] to solve [problem]; add a verified outcome if available.', { rule: 'no quantified outcome pattern found', actionVerbsFound: verbs }));
  }
  if (skills.length === 0) {
    issues.push(issue('important', 'skills_relevance', 'No recognizable skills were detected.', 'Role matching and recruiter search depend on clearly stated skills.', 'Skills section', 'List the tools and technologies you can support with evidence in projects or experience.'));
  }
  if (roles.length && matches[0]?.missingSkills.length) {
    issues.push(issue('important', 'skills_relevance', `Skills are missing for ${matches[0].roleName}.`, 'A visible skill gap helps you target practice before applying.', 'Skills and projects sections', `Prioritize these skills if they match your goals: ${matches[0].missingSkills.slice(0, 4).join(', ')}.`, null, null, { matched: matches[0].matchedSkills, missing: matches[0].missingSkills }));
  }
  if (!(resume.certifications ?? []).length) {
    issues.push(issue('nice_to_have', 'placement_relevance', 'No certifications were detected.', 'Relevant coursework or certifications can add context, though they do not replace project evidence.', 'Certifications section', 'Add relevant certifications only if completed; otherwise leave this section out.'));
  }

  const weights = {
    atsCompatibility: 0.2,
    formatStructure: 0.1,
    contentQuality: 0.15,
    projectQuality: 0.15,
    skillsRelevance: 0.15,
    placementRelevance: 0.15,
    consistencyCredibility: 0.1,
  };
  const score = clampScore(Object.entries(weights).reduce((total, [key, weight]) => total + subScores[key as keyof typeof subScores] * weight, 0));
  const criticalIssue = issues.some((item) => item.severity === 'critical');
  const verdict = criticalIssue || score < 45
    ? 'NOT READY - MAJOR REWORK'
    : score < 65
      ? 'NEEDS IMPROVEMENT'
      : score < 80
        ? 'ALMOST READY - MINOR FIXES'
        : 'READY TO APPLY';

  return { score, subScores, verdict, criticalIssue, issues, roleMatches: matches.slice(0, 5), modelVersion: 'rules-1' };
}
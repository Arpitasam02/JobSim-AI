import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeResume } from '../dist/resumes/analyzer.js';

const analystRole = {
  id: 'role-data-analyst',
  name: 'Data Analyst',
  skills: [
    { name: 'SQL', weight: 50, mustHave: true },
    { name: 'Python', weight: 30, mustHave: true },
    { name: 'Tableau', weight: 20, mustHave: false },
  ],
};

const strongResume = {
  contact: { email: 'alex@example.test', phone: '+1 555 123 4567' },
  summary: 'Entry-level analyst with project experience.',
  education: 'B.Tech, Computer Science',
  skills: { languages: ['Python', 'SQL'], tools: ['Tableau'] },
  projects: ['Built a Python and SQL dashboard; improved reporting time by 25%; https://example.test/project'],
  experience: [],
  certifications: ['Data analysis certificate'],
  rawSections: { skills: 'Python SQL Tableau', projects: 'Built a dashboard' },
  metadata: { pageCount: 1, readable: true, warnings: [] },
};

test('resume analysis produces bounded scores and explainable role matches', () => {
  const result = analyzeResume(strongResume, [analystRole], { cgpa: 8, internships: 2 });

  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.roleMatches[0].roleName, 'Data Analyst');
  assert.equal(result.roleMatches[0].score, 93);
  assert.match(result.roleMatches[0].explanation, /match 2\/2 listed must-have skills/);
});

test('critical contact and unreadable-file issues cap the verdict', () => {
  const result = analyzeResume({ metadata: { readable: false, pageCount: 1 } }, [analystRole]);

  assert.equal(result.criticalIssue, true);
  assert.equal(result.verdict, 'NOT READY - MAJOR REWORK');
  assert.ok(result.issues.filter((item) => item.severity === 'critical').length >= 2);
});

test('suggested project edits explicitly warn users to verify accuracy', () => {
  const result = analyzeResume({
    ...strongResume,
    projects: ['Built a small class project using Python.'],
  }, [analystRole]);
  const suggestion = result.issues.find((item) => item.category === 'content_quality');

  assert.ok(suggestion);
  assert.match(suggestion.afterText, /verify accuracy before using/i);
  assert.match(suggestion.suggestedFix, /Do not invent numbers/);
});
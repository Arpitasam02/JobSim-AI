export type JobEligibility = {
  minimumCgpa: number | null;
  eligibleBranches: string[];
  graduationYears: number[];
};

export type CandidateEligibility = {
  cgpa: number | null;
  branch: string | null;
  graduationYear: number | null;
};

export function isEligibleForJob(job: JobEligibility, candidate: CandidateEligibility): boolean {
  if (job.minimumCgpa !== null && candidate.cgpa !== null && candidate.cgpa < job.minimumCgpa) return false;
  if (job.eligibleBranches.length && candidate.branch && !job.eligibleBranches.includes(candidate.branch)) return false;
  if (job.graduationYears.length && candidate.graduationYear !== null && !job.graduationYears.includes(candidate.graduationYear)) return false;
  return true;
}

export function calculateSkillMatchScore(candidateSkills: string[], requiredSkills: string[]): number | null {
  const required = new Set(requiredSkills.map((skill) => skill.trim().toLocaleLowerCase()).filter(Boolean));
  if (!required.size) return null;
  const candidate = new Set(candidateSkills.map((skill) => skill.trim().toLocaleLowerCase()).filter(Boolean));
  const matched = [...required].filter((skill) => candidate.has(skill)).length;
  return Math.round((matched / required.size) * 10000) / 100;
}

export function redactBlindApplicant<T extends Record<string, unknown>>(
  applicant: T,
  blindScreening: boolean,
  shortlisted: boolean,
): Partial<T> {
  if (!blindScreening || shortlisted) return { ...applicant };
  const redacted: Record<string, unknown> = { ...applicant };
  delete redacted.name;
  delete redacted.email;
  delete redacted.institution;
  return redacted as Partial<T>;
}
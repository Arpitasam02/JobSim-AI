import type { ProbabilityComponentKey, ProbabilityInput } from './engine.js';

export type StoredProbabilityValues = {
  resume?: number | null;
  roleFit?: number | null;
  assessments?: number | null;
  interviewOverallScore?: number | null;
};

export type ProbabilityComponents = Record<ProbabilityComponentKey, number | null>;

function normalizedScore(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

export function buildProbabilityInputs(values: StoredProbabilityValues): ProbabilityInput {
  const resume = normalizedScore(values.resume);
  const roleFit = normalizedScore(values.roleFit);
  const assessments = normalizedScore(values.assessments);
  const interviews = values.interviewOverallScore === null || values.interviewOverallScore === undefined
    || !Number.isFinite(values.interviewOverallScore)
    ? undefined
    : normalizedScore(values.interviewOverallScore * 10);

  return {
    ...(resume === undefined ? {} : { resume }),
    ...(roleFit === undefined ? {} : { roleFit }),
    ...(assessments === undefined ? {} : { assessments }),
    ...(interviews === undefined ? {} : { interviews }),
  };
}

export function probabilityComponents(input: ProbabilityInput): ProbabilityComponents {
  return {
    resume: input.resume ?? null,
    roleFit: input.roleFit ?? null,
    assessments: input.assessments ?? null,
    interviews: input.interviews ?? null,
    profile: input.profile ?? null,
  };
}
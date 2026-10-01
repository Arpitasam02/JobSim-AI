export type ProbabilityComponentKey = 'resume' | 'roleFit' | 'assessments' | 'interviews' | 'profile';

export type ProbabilityWeights = Record<ProbabilityComponentKey, number>;

export type ProbabilityInput = Partial<Record<ProbabilityComponentKey, number | null | undefined>>;

export type ProbabilityConfig = {
  weights: ProbabilityWeights;
};

export type ProbabilityFactor = {
  key: ProbabilityComponentKey;
  label: string;
  score: number;
  impact: number;
  reason: string;
};

export type ProbabilityResult = {
  probability: number;
  confidence: 'Low' | 'Medium' | 'High';
  dataPoints: number;
  weightedScore: number;
  factors: ProbabilityFactor[];
};

export const defaultProbabilityWeights: ProbabilityWeights = {
  resume: 25,
  roleFit: 20,
  assessments: 25,
  interviews: 20,
  profile: 10,
};

const componentLabels: Record<ProbabilityComponentKey, string> = {
  resume: 'Resume score',
  roleFit: 'Role fit score',
  assessments: 'Assessment score',
  interviews: 'Interview score',
  profile: 'Profile strength',
};

const componentOrder: ProbabilityComponentKey[] = ['resume', 'roleFit', 'assessments', 'interviews', 'profile'];

function clampNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

export function createProbabilityConfig(weights: Partial<ProbabilityWeights>): ProbabilityConfig {
  const normalized: ProbabilityWeights = {
    resume: 0,
    roleFit: 0,
    assessments: 0,
    interviews: 0,
    profile: 0,
  };

  for (const key of componentOrder) {
    const value = weights[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Probability weight for ${key} is required.`);
    }
    normalized[key] = value;
  }

  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 0.0001) {
    throw new Error(`Probability weights must sum to 100. Received ${total}.`);
  }

  return { weights: normalized };
}

export function determineConfidence(dataPoints: number): 'Low' | 'Medium' | 'High' {
  if (dataPoints >= 4) return 'High';
  if (dataPoints >= 2) return 'Medium';
  return 'Low';
}

export function calculateProbability(input: ProbabilityInput, config: ProbabilityConfig = { weights: defaultProbabilityWeights }): ProbabilityResult {
  const available = componentOrder
    .map((key) => ({ key, value: input[key], label: componentLabels[key], weight: config.weights[key] }))
    .filter(({ value }) => typeof value === 'number' && Number.isFinite(value));

  const dataPoints = available.length;

  if (dataPoints === 0) {
    return {
      probability: 0,
      confidence: 'Low',
      dataPoints: 0,
      weightedScore: 0,
      factors: [],
    };
  }

  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = available.reduce((sum, item) => sum + item.weight * clampNumber(item.value as number), 0) / totalWeight;

  const logistic = 100 / (1 + Math.exp(-0.08 * (weightedScore - 50)));
  const probability = roundToOneDecimal(logistic);

  const factors = available
    .map(({ key, value, label }) => ({
      key,
      label,
      score: clampNumber(value as number),
      impact: Math.round(100 - clampNumber(value as number)),
      reason: 'Lower than the ideal benchmark for this component.',
    }))
    .sort((left, right) => right.impact - left.impact)
    .slice(0, 3);

  return {
    probability,
    confidence: determineConfidence(dataPoints),
    dataPoints,
    weightedScore: roundToOneDecimal(weightedScore),
    factors,
  };
}

export function simulateProbability(
  input: ProbabilityInput,
  changes: Partial<Record<ProbabilityComponentKey, number>>,
  config: ProbabilityConfig = { weights: defaultProbabilityWeights },
): {
  before: ProbabilityResult;
  after: ProbabilityResult;
  delta: number;
} {
  const before = calculateProbability(input, config);
  const nextInput: ProbabilityInput = { ...input };

  for (const [key, value] of Object.entries(changes) as [ProbabilityComponentKey, number][]) {
    nextInput[key] = value;
  }

  const after = calculateProbability(nextInput, config);
  const delta = roundToOneDecimal(after.probability - before.probability);

  return { before, after, delta };
}

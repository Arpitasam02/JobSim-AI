export type ScorableQuestion = {
  id: string;
  topic: string;
  marks: number;
  negativeMarks: number;
  correctAnswer: unknown;
};

export type ScoredAnswer = {
  questionId: string;
  answer: unknown;
  isCorrect: boolean | null;
  score: number;
};

export type AssessmentScore = {
  earnedMarks: number;
  maximumMarks: number;
  percentage: number;
  answers: ScoredAnswer[];
  topicBreakdown: Array<{ topic: string; correct: number; total: number; accuracy: number }>;
};

function normalizeAnswer(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function scoreAssessment(
  questions: ScorableQuestion[],
  answerMap: Map<string, unknown>,
): AssessmentScore {
  let earnedMarks = 0;
  const maximumMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  const topicTotals = new Map<string, { correct: number; total: number }>();
  const answers = questions.map((question) => {
    const hasAnswer = answerMap.has(question.id);
    const answer = answerMap.get(question.id) ?? null;
    const isCorrect = hasAnswer ? normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer) : null;
    const score = isCorrect === true ? question.marks : isCorrect === false ? -question.negativeMarks : 0;
    earnedMarks += score;

    const topic = topicTotals.get(question.topic) ?? { correct: 0, total: 0 };
    topic.total += 1;
    if (isCorrect) topic.correct += 1;
    topicTotals.set(question.topic, topic);

    return { questionId: question.id, answer, isCorrect, score };
  });

  return {
    earnedMarks,
    maximumMarks,
    percentage: maximumMarks > 0 ? Math.max(0, Math.min(100, (earnedMarks / maximumMarks) * 100)) : 0,
    answers,
    topicBreakdown: [...topicTotals.entries()].map(([topic, result]) => ({
      topic,
      correct: result.correct,
      total: result.total,
      accuracy: result.total ? (result.correct / result.total) * 100 : 0,
    })),
  };
}
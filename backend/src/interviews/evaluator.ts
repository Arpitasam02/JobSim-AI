export type InterviewPrompt = { id: string; question: string; idealAnswerOutline: string | null };
export type InterviewResponse = { questionId: string; answerText: string };

export type QuestionEvaluation = {
  questionId: string;
  question: string;
  score: number;
  rubric: Record<string, number>;
  evidence: string;
  strengths: string[];
  improvement: string;
  modelAnswerOutline: string;
};

export type InterviewEvaluation = {
  overallScore: number;
  shortlistRecommendation: 'Likely' | 'Borderline' | 'Unlikely';
  questions: QuestionEvaluation[];
  strengths: string[];
  improvements: string[];
  modelVersion: 'rules-interview-1';
};

const actionWordPattern = /\b(built|designed|implemented|tested|measured|improved|resolved|learned|led|delivered|analyzed|deployed)\b/i;
const outcomePattern = /\b(result|outcome|reduced|increased|improved|users|percent|%|faster|saved)\b/i;
const structurePattern = /\b(situation|task|action|result|first|then|because|finally)\b/i;

function clamp(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function evaluateTextInterview(
  prompts: InterviewPrompt[],
  responses: InterviewResponse[],
): InterviewEvaluation {
  const responseByQuestion = new Map(responses.map((response) => [response.questionId, response.answerText.trim()]));
  const questions = prompts.map((prompt) => {
    const answer = responseByQuestion.get(prompt.id) ?? '';
    const words = answer ? answer.split(/\s+/).filter(Boolean) : [];
    const lengthScore = Math.min(10, words.length / 12);
    const ownershipScore = actionWordPattern.test(answer) ? 9 : words.length > 0 ? 5 : 1;
    const outcomeScore = outcomePattern.test(answer) ? 9 : words.length > 30 ? 6 : words.length > 0 ? 4 : 1;
    const structureScore = structurePattern.test(answer) ? 9 : words.length > 25 ? 6 : words.length > 0 ? 4 : 1;
    const relevanceScore = words.length > 0 ? 7 : 1;
    const communicationScore = words.length > 220 ? 5 : words.length > 0 ? 7 : 1;
    const rubric = {
      technicalCorrectness: clamp(relevanceScore),
      depthOfKnowledge: clamp(lengthScore),
      problemSolving: clamp(structureScore),
      communicationClarity: clamp(communicationScore),
      answerStructure: clamp(structureScore),
      relevanceAndConciseness: clamp(words.length > 220 ? 5 : words.length > 8 ? 8 : 3),
      projectOwnership: clamp(ownershipScore),
    };
    const score = Math.round(Object.values(rubric).reduce((sum, value) => sum + value, 0) / Object.keys(rubric).length);
    const strengths = [
      ...(answer && ownershipScore >= 8 ? ['Describes personal actions rather than only team activity.'] : []),
      ...(answer && outcomeScore >= 8 ? ['Includes an outcome or evidence of impact.'] : []),
      ...(answer && structureScore >= 8 ? ['Uses a clear sequence to explain the answer.'] : []),
    ];
    const improvement = !answer
      ? 'Answer this question to receive specific feedback.'
      : !actionWordPattern.test(answer)
        ? 'Clarify what you personally did, which decisions you made, and how you verified the result.'
        : !outcomePattern.test(answer)
          ? 'Add a truthful outcome or learning; do not invent metrics.'
          : !structurePattern.test(answer)
            ? 'Organize the response into context, action, and outcome.'
            : 'Add a specific technical detail that demonstrates your reasoning.';
    return {
      questionId: prompt.id,
      question: prompt.question,
      score,
      rubric,
      evidence: answer ? answer.slice(0, 180) : 'No response recorded.',
      strengths,
      improvement,
      modelAnswerOutline: prompt.idealAnswerOutline ?? 'Address the context, your individual contribution, key decisions, validation, and a truthful outcome.',
    };
  });
  const overallScore = questions.length ? Math.round(questions.reduce((sum, question) => sum + question.score, 0) / questions.length) : 1;
  const shortlistRecommendation = overallScore >= 7 ? 'Likely' : overallScore >= 5 ? 'Borderline' : 'Unlikely';
  const strengths = [...new Set(questions.flatMap((question) => question.strengths))].slice(0, 5);
  const improvements = [...new Set(questions.map((question) => question.improvement))].filter((item) => !item.startsWith('Answer this')).slice(0, 5);
  return { overallScore, shortlistRecommendation, questions, strengths, improvements, modelVersion: 'rules-interview-1' };
}
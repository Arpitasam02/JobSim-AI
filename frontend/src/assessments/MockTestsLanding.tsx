import { ArrowRight, BookOpen, Brain, Calculator, Code2, FileText, MessageSquare, PenLine, Trophy } from 'lucide-react';

export type TestCategory = {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  topics: string[];
};

export const TEST_CATEGORIES: TestCategory[] = [
  { id: 'quantitative', label: 'Quantitative Aptitude', description: 'Percentages, ratios, averages, profit & loss, time & work, probability', icon: Calculator, color: '#e8f4fd', topics: ['Percentages', 'Ratios', 'Averages', 'Profit & Loss', 'Time & Work', 'Speed & Distance', 'Probability', 'Number Systems'] },
  { id: 'logical', label: 'Logical Reasoning', description: 'Series, coding-decoding, blood relations, directions, syllogisms', icon: Brain, color: '#f0f4ff', topics: ['Number Series', 'Coding-Decoding', 'Blood Relations', 'Directions', 'Syllogisms', 'Seating Arrangements'] },
  { id: 'puzzles', label: 'Puzzles', description: 'Logical puzzles, arrangements, sequences, scheduling problems', icon: Trophy, color: '#fff4e8', topics: ['Logical Puzzles', 'Arrangements', 'Sequences', 'Scheduling'] },
  { id: 'verbal', label: 'Verbal Ability', description: 'Vocabulary, synonyms, antonyms, sentence correction, verbal reasoning', icon: MessageSquare, color: '#f4fff0', topics: ['Synonyms', 'Antonyms', 'Sentence Correction', 'Verbal Reasoning'] },
  { id: 'pseudocode', label: 'Pseudocode', description: 'Code tracing, output prediction, loops, conditions, recursion', icon: Code2, color: '#fdf4ff', topics: ['Code Tracing', 'Output Prediction', 'Loops', 'Recursion', 'Arrays'] },
  { id: 'grammar', label: 'Grammar Test', description: 'Tenses, subject-verb agreement, articles, prepositions, punctuation', icon: BookOpen, color: '#fff8f0', topics: ['Tenses', 'Subject-Verb Agreement', 'Articles', 'Prepositions', 'Punctuation'] },
  { id: 'essay', label: 'Essay Writing', description: 'Topic-based essays, timed writing, word count, and feedback', icon: PenLine, color: '#f0fff8', topics: ['Argumentative', 'Descriptive', 'Analytical'] },
  { id: 'email', label: 'Email Writing', description: 'Professional email writing, subject lines, tone, and formatting', icon: FileText, color: '#fff0f4', topics: ['Formal Emails', 'Cold Emails', 'Follow-up Emails'] },
  { id: 'reading', label: 'Reading Comprehension', description: 'Passages followed by inference, vocabulary, and analytical questions', icon: BookOpen, color: '#f0f8ff', topics: ['Inference', 'Vocabulary in Context', 'Factual', 'Analytical'] },
  { id: 'programming', label: 'Programming & DSA', description: 'Arrays, strings, linked lists, trees, graphs, sorting, DP, greedy', icon: Code2, color: '#f8f0ff', topics: ['Arrays', 'Strings', 'Linked Lists', 'Trees', 'Graphs', 'Sorting', 'Dynamic Programming'] },
  { id: 'mixed', label: 'Mixed Placement Test', description: 'Complete placement-style assessment combining all categories', icon: Trophy, color: '#fffbf0', topics: ['All Categories'] },
];

type Props = {
  onSelectCategory: (category: TestCategory) => void;
  onStartExisting: () => void;
};

export default function MockTestsLanding({ onSelectCategory, onStartExisting }: Props) {
  return (
    <section className="assessment-workspace">
      <div className="assessment-page-heading">
        <div className="section-kicker">PLACEMENT PREPARATION</div>
        <h1>Mock Tests</h1>
        <p>Choose a category to practice. Each section has timed questions, instant scoring, and detailed explanations.</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#768073', fontSize: 13 }}>Select a category to begin</span>
        <button className="text-link" onClick={onStartExisting} type="button">View assigned tests <ArrowRight size={14} /></button>
      </div>
      <div className="mock-tests-grid">
        {TEST_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              className="mock-test-category-card"
              key={cat.id}
              onClick={() => onSelectCategory(cat)}
              style={{ '--card-bg': cat.color } as React.CSSProperties}
              type="button"
            >
              <div className="mock-test-card-icon" style={{ background: cat.color }}>
                <Icon size={22} />
              </div>
              <div className="mock-test-card-body">
                <strong>{cat.label}</strong>
                <p>{cat.description}</p>
                <div className="mock-test-topics">
                  {cat.topics.slice(0, 3).map((t) => <span key={t}>{t}</span>)}
                  {cat.topics.length > 3 && <span>+{cat.topics.length - 3} more</span>}
                </div>
              </div>
              <ArrowRight className="mock-test-card-arrow" size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

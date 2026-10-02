import { useState, type FormEvent } from 'react';
import { ArrowRight, Headphones, MessageCircle, Mic, X } from 'lucide-react';

type Props = { open: boolean; onOpen: () => void; onClose: () => void; onNavigate: (section: string) => void };
type SpeechEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechController = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};
type SpeechConstructor = new () => SpeechController;

type HelpReply = { title: string; text: string; destination?: string; button?: string };

function answerQuestion(question: string): HelpReply {
  const prompt = question.toLowerCase();
  if (/job|company|apply|application|opening/.test(prompt)) {
    return { title: 'Find an opening', text: 'Explore jobs lists open roles currently posted by companies on this platform. Add a resume first, then apply from the role that fits your goals.', destination: 'Explore jobs', button: 'Explore jobs' };
  }
  if (/dsa|data structure|algorithm|program|coding/.test(prompt)) {
    return { title: 'Practice programming', text: 'Choose a software or developer role, then start a technical mock interview at easy, medium, or hard level. The prompts include data structures and algorithms.', destination: 'Mock interviews', button: 'Open mock interviews' };
  }
  if (/interview|question/.test(prompt)) {
    return { title: 'Prepare for interviews', text: 'Pick a role, interview type, and difficulty. Technical prompts are tailored to the role and level; project interviews use your analyzed resume when available.', destination: 'Mock interviews', button: 'Practice an interview' };
  }
  if (/role|skill|roadmap|gap/.test(prompt)) {
    return { title: 'Explore role fit', text: 'Upload and analyze a resume to calculate role matches. Select any match to inspect skill gaps, then build a roadmap from the selected role.', destination: 'Role matches', button: 'View role matches' };
  }
  if (/resume|score|health|upload/.test(prompt)) {
    return { title: 'Start with your resume', text: 'Upload a readable PDF or DOCX in My resume. The health score and role fits stay at zero until analysis has produced real results.', destination: 'My resume', button: 'Open resume workspace' };
  }
  if (/error|failed|unexpected|not working/.test(prompt)) {
    return { title: 'Troubleshoot a workspace', text: 'Check that the API and PostgreSQL are running, then retry. Resume parsing also needs the AI service at its configured health URL. This guide cannot inspect private server logs.', destination: 'Overview', button: 'Back to overview' };
  }
  return { title: 'I can guide your next step', text: 'Ask about resumes, role fit, roadmaps, jobs, interviews, programming, or a workspace error. This local guide does not send your message to an external AI service.' };
}

export default function StudyAssistant({ open, onOpen, onClose, onNavigate }: Props) {
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState<HelpReply | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt) return;
    setReply(answerQuestion(prompt));
    setVoiceError('');
  }

  function startVoiceInput() {
    const speechWindow = window as unknown as { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError('Voice input is not supported in this browser. You can type your question instead.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) {
        setQuestion(transcript);
        setReply(answerQuestion(transcript));
      }
    };
    recognition.onerror = () => setVoiceError('Voice input could not start. Check microphone permission or type your question.');
    recognition.onend = () => setListening(false);
    setVoiceError('');
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceError('Voice input could not start. Type your question instead.');
    }
  }

  return <>
    <button className="assistant-launcher" aria-label={open ? 'Close study assistant' : 'Open study assistant'} onClick={open ? onClose : onOpen} type="button">
      {open ? <X size={20} /> : <MessageCircle size={20} />}<span>{open ? 'Close' : 'Help'}</span>
    </button>
    {open && <aside className="study-assistant-panel" aria-label="Study assistant">
      <header><span className="assistant-icon"><Headphones size={18} /></span><div><strong>Study assistant</strong><small>Private, local guidance</small></div><button aria-label="Close assistant" className="icon-button" onClick={onClose} type="button"><X size={17} /></button></header>
      <div className="assistant-conversation" aria-live="polite">
        {reply ? <article><strong>{reply.title}</strong><p>{reply.text}</p>{reply.destination && <button className="text-link" onClick={() => { onNavigate(reply.destination!); onClose(); }} type="button">{reply.button}<ArrowRight size={14} /></button>}</article> : <p>What are you working on? Try “How do I prepare for a software interview?”</p>}
      </div>
      {voiceError && <p className="assistant-voice-error" role="status">{voiceError}</p>}
      <form className="assistant-input-row" onSubmit={submit}>
        <input aria-label="Ask the study assistant" onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your next step" value={question} />
        <button aria-label={listening ? 'Listening' : 'Use voice input'} className={`icon-button ${listening ? 'assistant-listening' : ''}`} disabled={listening} onClick={startVoiceInput} title="Use voice input" type="button"><Mic size={17} /></button>
        <button aria-label="Send question" className="assistant-send" disabled={!question.trim()} type="submit"><ArrowRight size={17} /></button>
      </form>
    </aside>}
  </>;
}
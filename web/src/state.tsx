import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { generateChallenges, type Challenge, type PromptLanguage } from "./core/challenges";
import { Scorer, type Result } from "./core/scorer";

export interface Session {
  id: string;            // links the automatic contribution with a later identification
  challenges: Challenge[];
  replies: string[];
  result: Result | null;
}

interface AppState {
  scorer: Scorer | null;
  loadError: boolean;
  session: Session;
  promptLanguage: PromptLanguage;
  share: boolean;
  setReply(index: number, text: string): void;
  newChallenges(language?: PromptLanguage): void;
  analyze(): boolean;
  setShare(share: boolean): void;
}

const Context = createContext<AppState | null>(null);

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
}

function freshSession(language: PromptLanguage): Session {
  return { id: crypto.randomUUID(), challenges: generateChallenges(language), replies: ["", "", ""], result: null };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [scorer, setScorer] = useState<Scorer | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [promptLanguage, setPromptLanguage] = useState<PromptLanguage>(
    () => (stored("modeltrace.promptLanguage", "zh") === "en" ? "en" : "zh"),
  );
  const [session, setSession] = useState<Session>(() => freshSession(promptLanguage));
  const [share, setShareState] = useState(() => stored("modeltrace.share", "1") === "1");

  useEffect(() => {
    Scorer.load().then(setScorer, () => setLoadError(true));
  }, []);

  const setReply = useCallback((index: number, text: string) => {
    setSession((s) => ({ ...s, result: null, replies: s.replies.map((r, i) => (i === index ? text : r)) }));
  }, []);

  const newChallenges = useCallback((language?: PromptLanguage) => {
    const next = language ?? promptLanguage;
    if (language) {
      setPromptLanguage(language);
      store("modeltrace.promptLanguage", language);
    }
    setSession(freshSession(next));
  }, [promptLanguage]);

  const analyze = useCallback(() => {
    if (!scorer) return false;
    const result = scorer.categorize(session.replies.map((text, i) => ({ text, expectedCount: session.challenges[i].expectedCount })));
    if (result.used === 0) return false;
    setSession((s) => ({ ...s, id: crypto.randomUUID(), result }));
    return true;
  }, [scorer, session]);

  const setShare = useCallback((value: boolean) => {
    setShareState(value);
    store("modeltrace.share", value ? "1" : "0");
  }, []);

  const value = useMemo(
    () => ({ scorer, loadError, session, promptLanguage, share, setReply, newChallenges, analyze, setShare }),
    [scorer, loadError, session, promptLanguage, share, setReply, newChallenges, analyze, setShare],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const state = useContext(Context);
  if (!state) throw new Error("useApp outside AppProvider");
  return state;
}

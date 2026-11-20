import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { contribute } from "./api/submit";
import { generateChallenges, type Challenge, type PromptLanguage } from "./core/challenges";
import { Scorer, type Result } from "./core/scorer";

export interface Session {
  id: string;                   // links the automatic contribution with a later identification
  challenges: Challenge[];      // made once per page load or "New challenges"
  replies: string[];
  languages: PromptLanguage[];  // the language each prompt was shown in when last copied
}

interface AppState {
  scorer: Scorer | null;
  loadError: boolean;
  session: Session;
  result: Result | null;        // recomputed whenever a reply changes; null until one is usable
  promptLanguage: PromptLanguage;  // follows the page language
  share: boolean;
  setReply(index: number, text: string): void;
  copied(index: number): void;
  newChallenges(): void;
  contributeNow(): void;
  setShare(share: boolean): void;
}

const Context = createContext<AppState | null>(null);
const CONTRIBUTE_DELAY_MS = 1500;

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
  return { id: crypto.randomUUID(), challenges: generateChallenges(), replies: ["", "", ""], languages: [language, language, language] };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [scorer, setScorer] = useState<Scorer | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { i18n } = useTranslation();
  const promptLanguage: PromptLanguage = i18n.language === "zh" ? "zh" : "en";
  const [session, setSession] = useState<Session>(() => freshSession(promptLanguage));
  const [share, setShareState] = useState(() => stored("modeltrace.share", "1") === "1");
  const sent = useRef<string | null>(null);

  useEffect(() => {
    Scorer.load().then(setScorer, () => setLoadError(true));
  }, []);

  const result = useMemo(() => {
    if (!scorer) return null;
    const r = scorer.categorize(session.replies.map((text, i) => ({ text, expectedCount: session.challenges[i].expectedCount })));
    return r.used ? r : null;
  }, [scorer, session.replies, session.challenges]);

  const setReply = useCallback((index: number, text: string) => {
    setSession((s) => ({ ...s, replies: s.replies.map((r, i) => (i === index ? text : r)) }));
  }, []);

  const copied = useCallback((index: number) => {
    setSession((s) => ({ ...s, languages: s.languages.map((l, i) => (i === index ? promptLanguage : l)) }));
  }, [promptLanguage]);

  const newChallenges = useCallback(() => setSession(freshSession(promptLanguage)), [promptLanguage]);

  // Contribute once per distinct set of replies, in the background; failures are silent by design.
  const contributeNow = useCallback(() => {
    const key = session.replies.join("\u0000");
    if (!scorer || !result || !share || sent.current === key) return;
    sent.current = key;
    const id = crypto.randomUUID();
    setSession((s) => ({ ...s, id }));
    void contribute({ sessionId: id, bank: scorer.bank, challenges: session.challenges, languages: session.languages,
      replies: session.replies, result, identification: null });
  }, [scorer, result, share, session]);

  // Every reply usable: contribute automatically once the user stops typing.
  useEffect(() => {
    if (!result || result.used < session.challenges.length) return;
    const timer = window.setTimeout(contributeNow, CONTRIBUTE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [result, session.challenges.length, contributeNow]);

  const setShare = useCallback((value: boolean) => {
    setShareState(value);
    store("modeltrace.share", value ? "1" : "0");
  }, []);

  const value = useMemo(
    () => ({ scorer, loadError, session, result, promptLanguage, share, setReply, copied, newChallenges, contributeNow, setShare }),
    [scorer, loadError, session, result, promptLanguage, share, setReply, copied, newChallenges, contributeNow, setShare],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const state = useContext(Context);
  if (!state) throw new Error("useApp outside AppProvider");
  return state;
}

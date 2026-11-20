import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { promptFor, type Challenge } from "../core/challenges";
import type { Result } from "../core/scorer";
import { useApp } from "../state";

interface Step {
  title: string;
  text: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const RESULT = "result"; // focus target once every challenge is answered
const MIN_SHOWN = 0.01; // models below 1% are left out of the live panel

// Safari, and every iOS browser since they all run on WebKit, pops up a "Paste" bubble on each
// clipboard read, so the click-to-paste shortcut is left out there and the user pastes by hand.
const AUTO_PASTE = typeof navigator !== "undefined"
  && !(/Safari\//.test(navigator.userAgent) && !/Chrome\/|Chromium|Android|Edg\//.test(navigator.userAgent));

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** The prompt itself is the copy target: a click anywhere on it copies it. */
function PromptBox({ text, onCopy }: { text: string; onCopy(): void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await writeClipboard(text);
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void copy();
    }
  };
  return (
    <div role="button" tabIndex={0} className={`prompt ${copied ? "copied" : ""}`} title={t("home.clickToCopy")}
      aria-label={`${t("home.clickToCopy")}: ${text}`} onClick={() => void copy()} onKeyDown={onKey}>
      {text}
      <span className="copy-badge" aria-hidden="true">
        {copied ? (
          <><svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>{t("home.copied")}</>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        )}
      </span>
    </div>
  );
}

function ReplyBox({ index, challenge, onFilled }: { index: number; challenge: Challenge; onFilled(): void }) {
  const { t } = useTranslation();
  const { scorer, session, setReply } = useApp();
  const pasted = useRef(false);
  if (!scorer) return null;
  const text = session.replies[index];
  const count = scorer.count(text);
  const min = scorer.minimum(challenge.expectedCount);
  const usable = (value: string) => scorer.count(value) >= min;
  const state = !text.trim() ? "empty" : usable(text) ? "valid" : "invalid";

  // Clicking an empty box pastes the clipboard when it holds a usable reply (and not one already pasted).
  const pasteFromClipboard = async () => {
    if (!AUTO_PASTE || text.trim() || !navigator.clipboard?.readText) return;
    try {
      const clip = await navigator.clipboard.readText();
      if (usable(clip) && !session.replies.includes(clip)) {
        setReply(index, clip);
        onFilled();
      }
    } catch { /* permission refused or unsupported: the user pastes by hand */ }
  };

  // A paste that leaves a usable reply folds the challenge; typing never does.
  const onChange = (value: string) => {
    setReply(index, value);
    if (pasted.current && usable(value)) onFilled();
    pasted.current = false;
  };

  return (
    <div className="stack-xs">
      <textarea className={state} spellCheck={false} aria-label={t("home.replyLabel", { n: index + 1 })}
        aria-invalid={state === "invalid"} placeholder={t(AUTO_PASTE ? "home.placeholder" : "home.placeholderManual")}
        value={text} onClick={() => void pasteFromClipboard()} onPaste={() => { pasted.current = true; }}
        onChange={(e) => onChange(e.target.value)} />
      {state === "valid" && <span className="hint valid-text">✓ {t("home.valid", { count })}</span>}
      {state === "invalid" && <span className="hint invalid-text" role="alert">{t("home.invalid", { count, min })}</span>}
    </div>
  );
}

function LivePanel({ result, total }: { result: Result; total: number }) {
  const { t } = useTranslation();
  const { scorer } = useApp();
  if (!scorer) return null;
  const { bank } = scorer;
  const model = bank.models[result.top];
  const family = bank.families[result.familyTop];
  const likely = result.probs.map((p, i) => ({ p, m: bank.models[i] }))
    .filter(({ p }) => p >= MIN_SHOWN).sort((a, b) => b.p - a.p).slice(0, 5);
  return (
    <section className="card live" aria-live="polite" aria-label={t("home.likely")}>
      <div className="live-head">
        <span className={`chip tier-${result.tier}`}>{t(`result.tiers.${result.tier}.label`)}</span>
        <strong>{t(`result.tiers.${result.tier}.title`, { model: model.displayName, family: family.name })}</strong>
        <span className="muted small">{t("home.basedOn", { used: result.used, total })}</span>
        <Link to="/result" className="live-link">{t("home.details")} →</Link>
      </div>
      <ul className="likely">
        {likely.map(({ p, m }) => (
          <li key={m.id}>
            <span className="likely-name">{m.displayName}</span>
            <span className="bar"><span style={{ width: pct(p) }} /></span>
            <strong className="num">{pct(p)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TestPage() {
  const { t } = useTranslation();
  const { scorer, session, result, promptLanguage, newChallenges, copied } = useApp();
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [focusNext, setFocusNext] = useState<string | null>(null);
  const steps = t("home.steps", { returnObjects: true }) as Step[];

  // Once the next challenge has unfolded, move focus to its prompt and bring it into view;
  // with every challenge answered, focus goes to the full-result link instead.
  useEffect(() => {
    if (!focusNext) return;
    if (focusNext === RESULT) {
      document.querySelector<HTMLElement>(".live-link")?.focus({ preventScroll: true });
      setFocusNext(null);
      return;
    }
    const box = document.querySelector<HTMLElement>(`#challenge-${focusNext} .prompt`);
    box?.focus({ preventScroll: true });
    box?.closest("article")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFocusNext(null);
  }, [focusNext]);

  if (!scorer) return null;
  const { challenges, replies } = session;
  const usable = (i: number) => scorer.count(replies[i]) >= scorer.minimum(challenges[i].expectedCount);

  const toggle = (id: string) => setFolded((f) => {
    const next = new Set(f);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // Fold the challenge just filled, open the next one still missing a reply and move focus to its prompt.
  const filled = (i: number) => {
    const order = [...challenges.keys()].slice(i + 1).concat([...challenges.keys()].slice(0, i));
    const next = order.find((j) => !usable(j));
    setFolded((f) => {
      const out = new Set(f).add(challenges[i].id);
      if (next !== undefined) out.delete(challenges[next].id);
      return out;
    });
    setFocusNext(next === undefined ? RESULT : challenges[next].id);
  };

  return (
    <div className="stack-xl">
      <section className="hero">
        <div>
          <h1>{t("home.title")}</h1>
          <p className="lead">{t("home.lead")}</p>
        </div>
        <div className="chips">
          <span className="chip success">{t("home.local")}</span>
          <span className="chip">{t("home.bank", { count: scorer.bank.models.length, version: scorer.bank.version })}</span>
        </div>
      </section>

      {result ? <LivePanel result={result} total={challenges.length} /> : (
        <ol className="steps">
          {steps.map((step, i) => (
            <li key={step.title} className="card step">
              <span className="step-number">{i + 1}</span>
              <span><strong>{step.title}</strong><span className="muted">{step.text}</span></span>
            </li>
          ))}
        </ol>
      )}

      <section className="stack" aria-labelledby="challenges-title">
        <div className="row-between">
          <h2 id="challenges-title">{t("home.challenges")}</h2>
          <button type="button" className="button" onClick={() => { setFolded(new Set()); newChallenges(); }}>
            {t("home.newChallenges")}
          </button>
        </div>

        {challenges.map((challenge, i) => {
          const open = !folded.has(challenge.id);
          const done = usable(i);
          return (
            <article key={challenge.id} id={`challenge-${challenge.id}`} className={`card challenge ${open ? "" : "folded"}`}>
              <button type="button" className="challenge-head" aria-expanded={open} aria-controls={`body-${challenge.id}`}
                aria-label={t("home.toggle", { n: i + 1 })} onClick={() => toggle(challenge.id)}>
                <span className={`step-number ${done ? "done" : "dark"}`}>{done ? "✓" : i + 1}</span>
                <strong>{t("home.challenge", { n: i + 1 })}</strong>
                {done
                  ? <span className="valid-text">{t("home.valid", { count: scorer.count(replies[i]) })}</span>
                  : <span className="muted">{t("home.asks", { count: challenge.expectedCount })}</span>}
                <svg className="chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {open && (
                <div className="challenge-body" id={`body-${challenge.id}`}>
                  <div><PromptBox text={promptFor(challenge, promptLanguage)} onCopy={() => copied(i)} /></div>
                  <div><ReplyBox index={i} challenge={challenge} onFilled={() => filled(i)} /></div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

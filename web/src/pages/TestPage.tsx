import { useState, type KeyboardEvent } from "react";
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
const MIN_SHOWN = 0.01; // models below 1% are left out of the live panel

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

function ReplyBox({ index, challenge }: { index: number; challenge: Challenge }) {
  const { t } = useTranslation();
  const { scorer, session, setReply } = useApp();
  if (!scorer) return null;
  const text = session.replies[index];
  const count = scorer.count(text);
  const min = scorer.minimum(challenge.expectedCount);
  const state = !text.trim() ? "empty" : count >= min ? "valid" : "invalid";

  // Clicking an empty box pastes the clipboard when it holds a usable reply (and not one already pasted).
  const pasteFromClipboard = async () => {
    if (text.trim() || !navigator.clipboard?.readText) return;
    try {
      const clip = await navigator.clipboard.readText();
      if (scorer.count(clip) >= min && !session.replies.includes(clip)) setReply(index, clip);
    } catch { /* permission refused or unsupported: the user pastes by hand */ }
  };

  return (
    <div className="stack-xs">
      <textarea className={state} spellCheck={false} aria-label={t("home.replyLabel", { n: index + 1 })}
        aria-invalid={state === "invalid"} placeholder={t("home.placeholder")} value={text}
        onClick={() => void pasteFromClipboard()} onChange={(e) => setReply(index, e.target.value)} />
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
  const { scorer, session, result, promptLanguage, setPromptLanguage, newChallenges, copied } = useApp();
  const steps = t("home.steps", { returnObjects: true }) as Step[];
  if (!scorer) return null;

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

      {result ? <LivePanel result={result} total={session.challenges.length} /> : (
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
          <div className="row">
            <label className="select-label">
              {t("home.promptLanguage")}
              <select value={promptLanguage} onChange={(e) => setPromptLanguage(e.target.value as "zh" | "en")}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button type="button" className="button" onClick={newChallenges}>{t("home.newChallenges")}</button>
          </div>
        </div>

        {session.challenges.map((challenge, i) => (
          <article key={challenge.id} className="card challenge">
            <div className="challenge-head">
              <span className="step-number dark">{i + 1}</span>
              <strong>{t("home.challenge", { n: i + 1 })}</strong>
              <span className="muted">{t("home.asks", { count: challenge.expectedCount })}</span>
            </div>
            <div className="challenge-body">
              <div><PromptBox text={promptFor(challenge, promptLanguage)} onCopy={() => copied(i)} /></div>
              <div><ReplyBox index={i} challenge={challenge} /></div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "../state";

interface Step {
  title: string;
  text: string;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
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
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return <button type="button" className="button dark" onClick={copy}>{copied ? t("home.copied") : t("home.copy")}</button>;
}

export function TestPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { scorer, session, promptLanguage, setReply, newChallenges, analyze } = useApp();
  const steps = t("home.steps", { returnObjects: true }) as Step[];
  if (!scorer) return null;

  const status = session.challenges.map((c, i) => {
    const text = session.replies[i];
    const count = scorer.count(text);
    const min = scorer.minimum(c.expectedCount);
    return { count, min, state: !text.trim() ? "waiting" : count >= min ? "ready" : "short" };
  });
  const ready = status.filter((s) => s.state === "ready").length;

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

      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.title} className="card step">
            <span className="step-number">{i + 1}</span>
            <span><strong>{step.title}</strong><span className="muted">{step.text}</span></span>
          </li>
        ))}
      </ol>

      <section className="stack" aria-labelledby="challenges-title">
        <div className="row-between">
          <h2 id="challenges-title">{t("home.challenges")}</h2>
          <div className="row">
            <label className="select-label">
              {t("home.promptLanguage")}
              <select value={promptLanguage} onChange={(e) => newChallenges(e.target.value as "zh" | "en")}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button type="button" className="button" onClick={() => newChallenges()}>{t("home.newChallenges")}</button>
          </div>
        </div>

        {session.challenges.map((challenge, i) => {
          const s = status[i];
          return (
            <article key={challenge.id} className="card challenge">
              <div className="challenge-head">
                <div className="row">
                  <span className="step-number dark">{i + 1}</span>
                  <strong>{t("home.challenge", { n: i + 1 })}</strong>
                  <span className="muted">{t("home.asks", { count: challenge.expectedCount })}</span>
                </div>
                <span className={`chip ${s.state === "ready" ? "success" : s.state === "short" ? "warn" : ""}`}>
                  {s.state === "waiting" ? t("home.waiting") : t(`home.${s.state}`, { count: s.count })}
                </span>
              </div>
              <div className="challenge-body">
                <div className="stack-sm">
                  <span className="overline">{t("home.send")}</span>
                  <p className="prompt">{challenge.prompt}</p>
                  <div><CopyButton text={challenge.prompt} /></div>
                </div>
                <div className="stack-sm">
                  <label className="overline" htmlFor={`reply-${i}`}>{t("home.paste")}</label>
                  <textarea id={`reply-${i}`} spellCheck={false} placeholder={t("home.placeholder")}
                    value={session.replies[i]} onChange={(e) => setReply(i, e.target.value)} />
                  <span className={`hint ${s.state === "short" ? "warn-text" : ""}`}>
                    {s.state === "waiting" ? t("home.hintWaiting")
                      : s.state === "ready" ? t("home.hintReady", { count: s.count })
                      : t("home.hintShort", { count: s.count, min: s.min })}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="action-bar">
        <div className="stack-xs">
          <strong>{t("home.readyCount", { count: ready })}</strong>
          <span>{t("home.readyHint")}</span>
        </div>
        <button type="button" className="button accent large" disabled={ready === 0}
          onClick={() => analyze() && navigate("/result")}>
          {t("home.analyze")}
        </button>
      </section>
      <p className="muted small">{t("home.tip")}</p>
    </div>
  );
}

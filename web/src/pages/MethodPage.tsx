import { useTranslation } from "react-i18next";

interface Step {
  title: string;
  text: string;
}

interface Faq {
  q: string;
  a: string;
}

const TIERS = ["match", "family", "uncertain", "unknown"] as const;

export function MethodPage() {
  const { t } = useTranslation();
  const steps = t("method.steps", { returnObjects: true }) as Step[];
  const privacy = t("method.privacyItems", { returnObjects: true }) as string[];
  const limits = t("method.limitItems", { returnObjects: true }) as string[];
  const faq = t("method.faqItems", { returnObjects: true }) as Faq[];
  return (
    <div className="stack-xl">
      <section className="stack-sm narrow">
        <h1>{t("method.title")}</h1>
        <p className="lead">{t("method.lead")}</p>
      </section>

      <ol className="tiles three plain">
        {steps.map((s, i) => (
          <li key={s.title} className="card stack-sm">
            <span className="step-number dark">{i + 1}</span>
            <h2>{s.title}</h2>
            <p className="muted">{s.text}</p>
          </li>
        ))}
      </ol>

      <section className="stack">
        <h2>{t("method.verdicts")}</h2>
        <div className="tiles four">
          {TIERS.map((tier) => (
            <div key={tier} className="card stack-sm">
              <span className={`chip tier-${tier}`}>{t(`result.tiers.${tier}.label`)}</span>
              <p className="muted">{t(`result.tiers.${tier}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="columns">
        <section className="card stack-sm">
          <h2>{t("method.privacy")}</h2>
          <ul>{privacy.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section className="card stack-sm">
          <h2>{t("method.limits")}</h2>
          <ul>{limits.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>

      <section className="stack-sm">
        <h2>{t("method.faq")}</h2>
        {faq.map((item) => (
          <details key={item.q} className="card">
            <summary>{item.q}</summary>
            <p className="muted">{item.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

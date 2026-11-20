import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { contribute, type Identification } from "../api/submit";
import { useApp } from "../state";

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export function ResultPage() {
  const { t } = useTranslation();
  const { scorer, session, result, share, setShare, contributeNow } = useApp();
  const [identified, setIdentified] = useState(false);

  // Opening the result contributes it (once per set of replies) even if not every reply is in.
  useEffect(contributeNow, [contributeNow]);

  if (!scorer || !result) {
    return <div className="stack"><p className="notice">{t("result.none")}</p><Link to="/">{t("result.back")}</Link></div>;
  }
  const { bank } = scorer;
  const model = bank.models[result.top];
  const family = bank.families[result.familyTop];
  const tier = result.tier;
  const ranked = result.probs.map((p, i) => ({ p, m: bank.models[i] })).sort((a, b) => b.p - a.p).slice(0, 5);
  const vendors = result.familyProbs.map((p, i) => ({ p, f: bank.families[i] })).sort((a, b) => b.p - a.p).slice(0, 4);

  const identify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const identification: Identification = {
      family: String(form.get("family") ?? "other"),
      model: String(form.get("model") ?? "").trim(),
      note: String(form.get("note") ?? "").trim(),
    };
    if (share) {
      void contribute({ sessionId: session.id, bank, challenges: session.challenges, languages: session.languages,
        replies: session.replies, result, identification });
    }
    setIdentified(true);
  };

  return (
    <div className="stack-lg">
      <Link to="/" className="back-link">← {t("result.back")}</Link>

      <section className="card verdict" aria-label={t(`result.tiers.${tier}.label`)}>
        <span className={`chip tier-${tier}`}>{t(`result.tiers.${tier}.label`)}</span>
        <h1>{t(`result.tiers.${tier}.title`, { model: model.displayName, family: family.name })}</h1>
        <p className="lead">{t(`result.tiers.${tier}.text`)}</p>
        {tier === "family" && (
          <p className="muted">{t("result.closestKnown", { model: model.displayName, probability: pct(result.probs[result.top]) })}</p>
        )}
        <div className="tiles">
          <div className="tile"><span className="overline">{t("result.best")}</span><strong>{pct(result.probs[result.top])}</strong><span className="muted">{model.displayName}</span></div>
          <div className="tile"><span className="overline">{t("result.vendor")}</span><strong>{pct(result.familyProbs[result.familyTop])}</strong><span className="muted">{family.name}</span></div>
          <div className="tile"><span className="overline">{t("result.fit")}</span><strong>{result.lowFit ? t("result.fitWeak") : t("result.fitNormal")}</strong><span className="muted">{result.lowFit ? t("result.fitWeakText") : t("result.fitNormalText")}</span></div>
          <div className="tile"><span className="overline">{t("result.used")}</span><strong>{t("result.usedValue", { used: result.used, total: result.diagnostics.length })}</strong>
            <span className="muted">{result.diagnostics.map((d) => d.parsed).join(" · ")}</span></div>
        </div>
      </section>

      {tier !== "match" && (
        <section className="card stack" aria-labelledby="identify-title">
          <h2 id="identify-title">{t("result.identifyTitle")}</h2>
          {identified ? <p className="notice success">{t("result.identifyThanks")}</p> : (
            <form className="identify" onSubmit={identify}>
              <p className="muted">{t("result.identifyText")}</p>
              <label>{t("result.identifyFamily")}
                <select name="family" defaultValue={family.id}>
                  {bank.families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  <option value="other">{t("result.other")}</option>
                </select>
              </label>
              <label>{t("result.identifyModel")}
                <input name="model" required maxLength={120} placeholder={t("result.identifyModelPlaceholder")} />
              </label>
              <label>{t("result.identifyNote")}
                <input name="note" maxLength={200} placeholder={t("result.identifyNotePlaceholder")} />
              </label>
              <div><button type="submit" className="button dark">{t("result.identifySend")}</button></div>
            </form>
          )}
        </section>
      )}

      <div className="columns">
        <section className="card stack" aria-labelledby="closest-title">
          <h2 id="closest-title">{t("result.closest")}</h2>
          {ranked.map(({ p, m }) => (
            <div key={m.id} className="bar-row">
              <div className="row-between">
                <span><strong>{m.displayName}</strong> <span className="muted small">{bank.families[m.family].name}</span></span>
                <strong className="num">{pct(p)}</strong>
              </div>
              <div className="bar"><span style={{ width: pct(p) }} /></div>
            </div>
          ))}
        </section>
        <section className="card stack" aria-labelledby="vendors-title">
          <h2 id="vendors-title">{t("result.vendors")}</h2>
          {vendors.map(({ p, f }) => (
            <div key={f.id} className="bar-row">
              <div className="row-between"><strong>{f.name}</strong><strong className="num">{pct(p)}</strong></div>
              <div className="bar"><span style={{ width: pct(p) }} /></div>
            </div>
          ))}
        </section>
      </div>

      <section className="card stack" aria-labelledby="replies-title">
        <h2 id="replies-title">{t("result.perReply")}</h2>
        <div className="tiles">
          {result.diagnostics.map((d, i) => (
            <div key={i} className="tile">
              <span className="overline">{t("result.reply", { n: i + 1 })}</span>
              <strong>{d.accepted ? bank.models[d.top].displayName : "—"}</strong>
              <span className="muted">{d.accepted ? t("result.counted", { count: d.parsed }) : t("result.ignored", { count: d.parsed, min: d.minimum })}</span>
            </div>
          ))}
        </div>
      </section>

      <label className="share">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        <span><strong>{t("result.share")}</strong><span className="muted small">{t("result.shareDetail")}</span></span>
      </label>

      <div className="muted small stack-xs">
        <p><Link to="/models">{t("result.caveat1")}</Link></p>
        <p>{t("result.caveat2")}</p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "../core/scorer";
import { useApp } from "../state";

const MAIN_FAMILIES = ["openai", "anthropic", "google"];
const SOURCES: ModelInfo["source"][] = ["official", "partner", "host", "reseller"];
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function ModelsPage() {
  const { t } = useTranslation();
  const { scorer } = useApp();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  if (!scorer) return null;
  const { bank } = scorer;
  // "vendor if unlisted" is undefined for a vendor's only model: leaving it out removes the vendor
  const perFamily = bank.models.reduce<Record<number, number>>((n, m) => ({ ...n, [m.family]: (n[m.family] ?? 0) + 1 }), {});

  const filters = [
    { id: "all", label: t("models.all") },
    ...bank.families.filter((f) => MAIN_FAMILIES.includes(f.id)).map((f) => ({ id: f.id, label: f.name })),
    { id: "others", label: t("models.others") },
  ];
  const q = query.trim().toLowerCase();
  const rows = bank.models.filter((m) => {
    const fid = bank.families[m.family].id;
    const byFamily = filter === "all" || fid === filter || (filter === "others" && !MAIN_FAMILIES.includes(fid));
    return byFamily && (!q || m.displayName.toLowerCase().includes(q) || m.members.some((id) => id.includes(q)));
  });

  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <h1>{t("models.title")}</h1>
        <p className="lead">{t("models.lead")}</p>
      </section>

      <section className="tiles four">
        {SOURCES.map((s) => (
          <div key={s} className="tile">
            <span className={`chip source-${s}`}>{t(`models.sources.${s}.name`)}</span>
            <span className="muted small">{t(`models.sources.${s}.text`)}</span>
          </div>
        ))}
      </section>

      <section className="card stack">
        <div className="row wrap">
          <input type="search" className="search" aria-label={t("models.search")} placeholder={t("models.search")}
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {filters.map((f) => (
            <button key={f.id} type="button" className={`pill ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("models.columns.model")}</th><th>{t("models.columns.vendor")}</th><th>{t("models.columns.source")}</th>
                <th>{t("models.columns.answers")}</th><th>{t("models.columns.acc3")}</th><th>{t("models.columns.acc1")}</th>
                <th>{t("models.columns.fam3")}</th><th>{t("models.columns.fam3Unseen")}</th>
                <th>{t("models.columns.collected")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.displayName}</strong>
                    {m.members.length > 1 && <span className="muted small block">{t("models.group", { count: m.members.length })}</span>}
                  </td>
                  <td>{bank.families[m.family].name}</td>
                  <td><span className={`chip source-${m.source}`} title={m.providers.join(", ")}>{t(`models.sources.${m.source}.name`)}</span></td>
                  <td className="num">{m.responses}</td>
                  <td className="num strong">{pct(m.acc3)}</td>
                  <td className="num">{pct(m.acc1)}</td>
                  <td className="num">{pct(m.fam3)}</td>
                  <td className="num" title={perFamily[m.family] < 2 ? t("models.onlyModel") : undefined}>
                    {perFamily[m.family] < 2 ? "—" : pct(m.fam3Unseen)}
                  </td>
                  <td className="muted nowrap">{m.collected.replace("..", " – ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t("models.footnote")}</p>
      </section>
    </div>
  );
}

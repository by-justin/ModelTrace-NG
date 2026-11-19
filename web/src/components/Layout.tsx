import { NavLink, Outlet, ScrollRestoration } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { setLanguage } from "../i18n";
import { useApp } from "../state";

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="currentColor" />
      <path d="M7 18 L11 10 L14 15 L17 8 L21 18" stroke="var(--surface)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const { scorer, loadError } = useApp();
  return (
    <div className="app">
      <ScrollRestoration />
      <header className="topbar">
        <div className="container topbar-inner">
          <NavLink to="/" className="brand">
            <Logo />
            <span>ModelTrace</span>
          </NavLink>
          <nav aria-label="Main" className="nav">
            <NavLink to="/" end>{t("nav.test")}</NavLink>
            <NavLink to="/models">{t("nav.models")}</NavLink>
            <NavLink to="/method">{t("nav.method")}</NavLink>
            <span className="divider" aria-hidden="true" />
            <button type="button" className="button ghost" aria-label={t("nav.languageLabel")}
              onClick={() => setLanguage(i18n.language === "zh" ? "en" : "zh")}>
              {t("nav.language")}
            </button>
            <a className="icon-link" href="https://github.com/xqy2006/ModelTrace" aria-label={t("nav.github")}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
          </nav>
        </div>
      </header>
      <main className="container main">
        {loadError ? <p className="notice warn">{t("common.loadError")}</p>
          : scorer ? <Outlet /> : <p className="notice">{t("common.loading")}</p>}
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <span>{t("method.footer")}</span>
          {scorer && <span>{t("home.bank", { count: scorer.bank.models.length, version: scorer.bank.version })}</span>}
        </div>
      </footer>
    </div>
  );
}

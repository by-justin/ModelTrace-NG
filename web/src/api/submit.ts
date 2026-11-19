// Optional crowd contribution. Everything here is best effort: when no API is configured, or any
// step fails, nothing happens and the user is never told. The site works fully without it.
import { solveChallengeWorkers } from "altcha-lib/v1";
import AltchaWorker from "altcha-lib/v1/worker?worker";
import type { Challenge } from "../core/challenges";
import type { BankInfo, Result } from "../core/scorer";
import { browserFingerprint } from "./fingerprint";

export interface Identification {
  family: string;  // a family id from the bank, or "other"
  model: string;   // free text: name and version as the user knows it
  note: string;
}

export interface SubmissionInput {
  sessionId: string;
  bank: BankInfo;
  challenges: Challenge[];
  replies: string[];
  result: Result;
  identification: Identification | null;
}

interface AppConfig {
  apiBase: string | null;
}

let config: Promise<AppConfig> | null = null;

/** Reads public/config.json once. {"apiBase": null} (the default) disables contributions. */
export function loadConfig(): Promise<AppConfig> {
  config ??= fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" })
    .then((r) => r.json() as Promise<AppConfig>)
    .then((c) => ({ apiBase: c.apiBase ? c.apiBase.replace(/\/+$/, "") : null }))
    .catch(() => ({ apiBase: null }));
  return config;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The JSON body stored by the API ("modeltrace-submission/1"). */
export async function submissionBody(input: SubmissionInput): Promise<object> {
  const { bank, result } = input;
  const order = result.probs.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 5);
  return {
    schema: "modeltrace-submission/1",
    session_id: input.sessionId,
    sent_at: new Date().toISOString(),
    bank_version: bank.version,
    client: { app: "web", version: import.meta.env.VITE_APP_VERSION ?? "dev", language: navigator.language },
    challenges: input.challenges.map((c) => ({ id: c.id, prompt: c.prompt, expected_count: c.expectedCount, language: c.language })),
    replies: input.replies.map((text, i) => ({ text, expected_count: input.challenges[i].expectedCount })),
    result: {
      used: result.used,
      tier: result.tier,
      known: result.known,
      model: result.used ? bank.models[result.top].id : null,
      family: result.used ? bank.families[result.familyTop].id : null,
      family_probability: result.used ? result.familyProbs[result.familyTop] : null,
      candidates: order.map(([p, i]) => ({ id: bank.models[i].id, probability: p })),
      diagnostics: result.diagnostics,
    },
    identification: input.identification,
    fingerprint: await browserFingerprint(),
  };
}

/** Stamp the body with ALTCHA proof of work (in web workers) and send it. Never throws. */
export async function contribute(input: SubmissionInput): Promise<boolean> {
  try {
    const { apiBase } = await loadConfig();
    if (!apiBase) return false;
    const bytes = new TextEncoder().encode(JSON.stringify(await submissionBody(input)));
    const stamp = await fetch(`${apiBase}/v1/stamp?h=${await sha256Hex(bytes)}`);
    if (!stamp.ok) return false;
    const challenge = await stamp.json();
    const solution = await solveChallengeWorkers(
      () => new AltchaWorker(), 2, challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxNumber,
    );
    if (!solution) return false;
    const payload = btoa(JSON.stringify({
      algorithm: challenge.algorithm, challenge: challenge.challenge, number: solution.number,
      salt: challenge.salt, signature: challenge.signature,
    }));
    const response = await fetch(`${apiBase}/v1/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Altcha: payload },
      body: bytes,
      keepalive: bytes.length < 60_000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

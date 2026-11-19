// Browser fingerprint sent with contributions (FingerprintJS, open-source edition).
// Long component values (canvas renders and the like) are replaced by their SHA-256.
import FingerprintJS from "@fingerprintjs/fingerprintjs";

export interface BrowserFingerprint {
  visitor_id: string;
  confidence: number;
  components: Record<string, unknown>;
}

let cached: Promise<BrowserFingerprint | null> | null = null;

async function compact(value: unknown): Promise<unknown> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= 256) return value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return "sha256:" + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function browserFingerprint(): Promise<BrowserFingerprint | null> {
  cached ??= (async () => {
    const agent = await FingerprintJS.load({ monitoring: false });
    const result = await agent.get();
    const components: Record<string, unknown> = {};
    for (const [name, component] of Object.entries(result.components)) {
      components[name] = "value" in component ? await compact(component.value) : { error: String(component.error) };
    }
    return { visitor_id: result.visitorId, confidence: result.confidence.score, components };
  })().catch(() => null);
  return cached;
}

// Browser side of the categorizer: the TinyGo build of core/trace plus bank metadata.
// The calling convention is documented in core/cmd/wasm/main.go.
import * as flatbuffers from "flatbuffers";
import { Bank as FbBank } from "./fb/mtfb/bank";

export type Tier = "none" | "match" | "family" | "uncertain" | "unknown";
const TIERS: Tier[] = ["none", "match", "family", "uncertain", "unknown"];

export interface ModelInfo {
  id: string;
  displayName: string;
  family: number;
  members: string[];
  source: "official" | "partner" | "host" | "reseller";
  providers: string[];
  collected: string;
  responses: number;
  acc1: number;
  acc3: number;
  fam3: number;        // vendor named correctly, 3 replies, prompt setup held out
  fam3Unseen: number;  // vendor named correctly when this model is left out of the bank
}

export interface FamilyInfo {
  id: string;
  name: string;
}

export interface BankInfo {
  version: string;
  builtAt: string;
  models: ModelInfo[];
  families: FamilyInfo[];
}

export interface ReplyDiag {
  parsed: number;
  minimum: number;
  accepted: boolean;
  top: number;
}

export interface Result {
  used: number;
  tier: Tier;
  top: number;
  familyTop: number;
  known: number;
  lowFit: boolean;   // the closest model fits worse than ~99% of genuine answers
  probs: number[];
  familyProbs: number[];
  diagnostics: ReplyDiag[];
}

export interface Reply {
  text: string;
  expectedCount: number;
}

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  buffer(n: number): number;
  result(): number;
  load_bank(n: number): number;
  count(n: number): number;
  minimum(expected: number): number;
  categorize(n: number): number;
}

const encoder = new TextEncoder();

function readBank(bytes: Uint8Array): BankInfo {
  const bank = FbBank.getRootAsBank(new flatbuffers.ByteBuffer(bytes));
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  return {
    version: bank.version() ?? "",
    builtAt: bank.builtAt() ?? "",
    families: range(bank.familiesLength()).map((i) => {
      const f = bank.families(i)!;
      return { id: f.id() ?? "", name: f.name() ?? "" };
    }),
    models: range(bank.modelsLength()).map((i) => {
      const m = bank.models(i)!;
      return {
        id: m.id() ?? "",
        displayName: m.displayName() ?? "",
        family: m.family(),
        members: range(m.membersLength()).map((j) => m.members(j)),
        source: (m.source() ?? "host") as ModelInfo["source"],
        providers: range(m.providersLength()).map((j) => m.providers(j)),
        collected: m.collected() ?? "",
        responses: m.responses(),
        acc1: m.acc1(),
        acc3: m.acc3(),
        fam3: m.fam3(),
        fam3Unseen: m.fam3Unseen(),
      };
    }),
  };
}

export class Scorer {
  private constructor(private readonly x: Exports, readonly bank: BankInfo) {}

  static async load(base: string = import.meta.env.BASE_URL): Promise<Scorer> {
    const [wasm, bank] = await Promise.all([
      fetch(`${base}trace.wasm`).then((r) => r.arrayBuffer()),
      fetch(`${base}bank.fb`).then((r) => r.arrayBuffer()),
    ]);
    return Scorer.fromBytes(wasm, new Uint8Array(bank));
  }

  static async fromBytes(wasm: BufferSource, bank: Uint8Array): Promise<Scorer> {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const x = instance.exports as unknown as Exports;
    x._initialize();
    const scorer = new Scorer(x, readBank(bank));
    if (x.load_bank(scorer.put(bank)) <= 0) throw new Error("bank failed to load");
    return scorer;
  }

  // Copy bytes into WebAssembly memory. Call buffer() first: growing memory detaches old views.
  private put(bytes: Uint8Array): number {
    const ptr = this.x.buffer(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
  }

  /** How many numbers a reply contains, read the same way the scorer reads it. */
  count(text: string): number {
    return text ? this.x.count(this.put(encoder.encode(text))) : 0;
  }

  /** How many numbers a reply needs to count. */
  minimum(expectedCount: number): number {
    return this.x.minimum(expectedCount);
  }

  categorize(replies: Reply[]): Result {
    const texts = replies.map((r) => encoder.encode(r.text));
    const buf = new Uint8Array(4 + texts.reduce((n, t) => n + 8 + t.length, 0));
    const view = new DataView(buf.buffer);
    view.setUint32(0, texts.length, true);
    let pos = 4;
    replies.forEach((r, i) => {
      view.setUint32(pos, r.expectedCount, true);
      view.setUint32(pos + 4, texts[i].length, true);
      buf.set(texts[i], pos + 8);
      pos += 8 + texts[i].length;
    });
    const n = this.x.categorize(this.put(buf));
    const out = new Float64Array(this.x.memory.buffer, this.x.result(), n).slice();
    const models = out[6];
    const families = out[7];
    const probs = Array.from(out.subarray(8, 8 + models));
    const familyProbs = Array.from(out.subarray(8 + models, 8 + models + families));
    let p = 8 + models + families;
    const diagnostics: ReplyDiag[] = [];
    for (let i = 0, count = out[p++]; i < count; i++, p += 4) {
      diagnostics.push({ parsed: out[p], minimum: out[p + 1], accepted: out[p + 2] === 1, top: out[p + 3] });
    }
    return { used: out[0], tier: TIERS[out[1]], top: out[2], familyTop: out[3], known: out[4], lowFit: out[5] === 1, probs, familyProbs, diagnostics };
  }
}

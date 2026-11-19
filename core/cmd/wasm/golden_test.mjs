// Runs the TinyGo build against the golden cases: node cmd/wasm/golden_test.mjs build/trace.wasm
import { readFileSync } from "node:fs";

const [wasmPath = "build/trace.wasm"] = process.argv.slice(2);
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const x = instance.exports;
x._initialize(); // runs Go package initialisation; required before any other call
// call buffer() before touching memory.buffer: growing memory detaches old views
const put = (bytes) => { const ptr = x.buffer(bytes.length); new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes); return bytes.length; };

const models = x.load_bank(put(readFileSync("../data/bank/bank.fb")));
if (models <= 0) throw new Error("bank did not load");
const golden = JSON.parse(readFileSync("trace/testdata/golden.json", "utf8"));
const enc = new TextEncoder();
const tiers = ["none", "match", "family", "uncertain", "unknown"];
let failures = 0;
for (const c of golden.cases) {
  const texts = c.replies.map((r) => enc.encode(r.text));
  const buf = new Uint8Array(4 + texts.reduce((n, t) => n + 8 + t.length, 0));
  const view = new DataView(buf.buffer);
  view.setUint32(0, texts.length, true);
  let pos = 4;
  c.replies.forEach((r, i) => {
    view.setUint32(pos, r.expected_count, true); view.setUint32(pos + 4, texts[i].length, true);
    buf.set(texts[i], pos + 8); pos += 8 + texts[i].length;
  });
  const n = x.categorize(put(buf));
  const out = new Float64Array(x.memory.buffer, x.result(), n);
  const e = c.expected;
  const ok = out[0] === e.used && tiers[out[1]] === e.tier &&
    (e.used === 0 || (out[2] === e.top && out[3] === e.family_top && Math.abs(out[4] - e.known) < 1e-6 &&
      e.probs.every((p, i) => Math.abs(out[7 + i] - p) < 1e-6)));
  if (!ok) { failures++; console.error("FAIL", c.name, Array.from(out.slice(0, 5)), e.used, e.tier); }
}
const sample = enc.encode("12, 300, 7 and 9 10");
console.log(`count() on a sample: ${x.count(put(sample))}; minimum(300) = ${x.minimum(300)}`);
console.log(`${golden.cases.length - failures}/${golden.cases.length} golden cases match (${models} models)`);
process.exit(failures ? 1 : 0);

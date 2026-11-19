// Copies the bank and the TinyGo WebAssembly scorer into public/ before dev and build.
import { copyFileSync, existsSync } from "node:fs";

const assets = [
  ["../data/bank/bank.fb", "public/bank.fb", "python -m pipeline.build"],
  ["../core/build/trace.wasm", "public/trace.wasm",
   "cd core && tinygo build -o build/trace.wasm -target=wasm-unknown -no-debug -opt=z ./cmd/wasm"],
];
for (const [from, to, how] of assets) {
  if (!existsSync(from)) {
    console.error(`missing ${from}; create it with: ${how}`);
    process.exit(1);
  }
  copyFileSync(from, to);
}
console.log("copied bank.fb and trace.wasm into public/");

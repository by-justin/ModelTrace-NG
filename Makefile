# One entry point for the pipeline and the builds. Typical loops:
#   make references bank      import collected answers, rebuild the bank and golden cases
#   make test                 core, API, WebAssembly and web tests
#   make site / make dev      build or serve the static site
# Tools: python3 with pipeline/requirements.txt, go, tinygo + binaryen (wasm-opt), node/npm.

PYTHON ?= python3
TINYGO ?= tinygo
NPM    ?= npm
WASM   := core/build/trace.wasm

.PHONY: help references bank golden wasm test test-go test-wasm test-web site dev api clean all

help:
	@echo "make references  copy staging/openrouter_*.jsonl into data/references (slim)"
	@echo "make bank        build data/bank/{bank.json,bank.fb,report.json} and core golden cases"
	@echo "make wasm        TinyGo build of core/trace -> $(WASM)"
	@echo "make test        Go core + API tests, WebAssembly golden check, web tests"
	@echo "make site        build web/dist (static site)"
	@echo "make dev         serve the site locally with Vite"
	@echo "make api         run the API locally on :8080"
	@echo "make all         references, bank, test, site"

# Collected answers live in staging/ (git-ignored) until they are slimmed into data/references.
references:
	@for f in staging/openrouter_*.jsonl; do \
		[ -e "$$f" ] || { echo "no staging/openrouter_*.jsonl files"; exit 0; }; \
		$(PYTHON) -m pipeline.collect slim "$$f" "data/references/$$(basename $$f)"; \
	done

bank:
	$(PYTHON) -m pipeline.build
	$(MAKE) golden

golden:
	$(PYTHON) -m pipeline.golden

$(WASM): $(wildcard core/trace/*.go core/cmd/wasm/*.go core/internal/mtfb/*.go)
	cd core && $(TINYGO) build -o build/trace.wasm -target=wasm-unknown -no-debug -opt=z ./cmd/wasm

wasm: $(WASM)

test: test-go test-wasm test-web

test-go:
	cd core && go vet ./... && go test ./...
	cd backend && go vet ./... && go test ./...

test-wasm: $(WASM)
	cd core && node cmd/wasm/golden_test.mjs build/trace.wasm

web/node_modules: web/package-lock.json
	cd web && $(NPM) ci
	@touch web/node_modules

test-web: web/node_modules
	cd web && $(NPM) test

site: $(WASM) web/node_modules
	cd web && $(NPM) run build

dev: $(WASM) web/node_modules
	cd web && $(NPM) run dev

api:
	cd backend && go run ./cmd/api

clean:
	rm -rf core/build web/dist web/public/bank.fb web/public/trace.wasm

all: references bank test site

{
  description = "ModelTrace NG: development environment and project commands";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python312;

        tools = with pkgs; [
          # Go: API and scorer core
          go gopls gotools golangci-lint
          # WebAssembly build of the core, and the bank schema compiler
          tinygo binaryen flatbuffers
          # Web
          nodejs_22 pnpm
          # Python pipeline
          python uv ruff
          # Repository hygiene and local services
          pre-commit git jq postgresql_17
        ];

        # `mt <command>`: the project's tasks, run from anywhere inside the repository.
        mt = pkgs.writeShellApplication {
          name = "mt";
          runtimeInputs = tools;
          text = ''
            cd "$(git rev-parse --show-toplevel)"
            wasm() { (cd core && tinygo build -o build/trace.wasm -target=wasm-unknown -no-debug -opt=z ./cmd/wasm); }
            web_deps() { (cd web && pnpm install --frozen-lockfile); }
            cmd="''${1:-help}"
            shift || true
            case "$cmd" in
              collect) uv run python -m pipeline.collect run "$@" ;;
              collect-anthropic) uv run python -m pipeline.anthropic_batch "$@" ;;
              import)
                if [ "$#" -eq 0 ]; then set -- staging/openrouter_*.jsonl staging/anthropic.jsonl; fi
                uv run python -m pipeline.collect import "$@" ;;
              bank)    uv run python -m pipeline.build && uv run python -m pipeline.golden ;;
              wasm)    wasm ;;
              test)
                (cd core && go vet ./... && go test ./...)
                (cd backend && go vet ./... && go test ./...)
                wasm && (cd core && node cmd/wasm/golden_test.mjs build/trace.wasm)
                web_deps && (cd web && pnpm test) ;;
              site)    wasm && web_deps && (cd web && pnpm build) ;;
              dev)     wasm && web_deps && (cd web && pnpm dev "$@") ;;
              api)     (cd backend && go run ./cmd/api) ;;
              check)   pre-commit run --all-files ;;
              *)
                cat <<'EOF'
            mt collect --model … --provider … --label … --out staging/x.jsonl --budget 1   collect the suite for one model
            mt collect-anthropic --models a,b --out staging/anthropic.jsonl   same through Anthropic's Message Batches API
            mt import [staging files]   file collected answers into data/records (default: staging/openrouter_*.jsonl and anthropic.jsonl)
            mt bank                     build data/bank and the golden test cases
            mt test                     Go core + API, WebAssembly golden check, web tests
            mt site | mt dev            build web/dist | serve the site locally
            mt api                      run the API on :8080
            mt check                    run every pre-commit hook on the whole repository
            EOF
                ;;
            esac
          '';
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = tools ++ [ mt ];
          env = {
            UV_PYTHON = "${python}/bin/python3.12";
            UV_PYTHON_DOWNLOADS = "never";
          } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            # uv installs manylinux wheels (numpy, scikit-learn) that link against the system
            # C++ runtime, which a Nix environment does not expose by default.
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.zlib ];
          };
          shellHook = ''
            if [ -f .pre-commit-config.yaml ] && [ -d .git ] && [ ! -f .git/hooks/pre-commit ]; then
              pre-commit install >/dev/null
            fi
            echo "ModelTrace NG dev shell — run 'mt' for project commands"
          '';
        };
        packages.mt = mt;
      });
}

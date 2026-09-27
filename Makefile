# Developer and CI entry points. Recipes call pnpm and cargo directly so this
# file cannot drift from the tools it wraps. GitHub Actions sets CI=true, which
# adds --locked to Cargo so the committed Cargo.lock is enforced.

.DEFAULT_GOAL := help

.PHONY: help check check-ts check-rust \
	fmt fmt-ts fmt-rust fmt-check fmt-check-ts fmt-check-rust \
	clippy idl typecheck \
	test test-ts test-rust \
	build build-rust clean

ifdef CI
CARGO_LOCKED := --locked
endif

help:
	@echo "check          prettier, tsc, rustfmt, clippy, IDL copy"
	@echo "check-ts       prettier --check and tsc"
	@echo "check-rust     rustfmt --check, clippy -D warnings, IDL copy"
	@echo "test           vitest and cargo test"
	@echo "test-ts        vitest run"
	@echo "test-rust      cargo test --workspace"
	@echo "build          TypeScript package (tsup + dts)"
	@echo "build-rust     cargo build --workspace"
	@echo "fmt            prettier --write and cargo fmt"
	@echo "fmt-check      prettier --check and cargo fmt --check"
	@echo "typecheck      tsc (tsconfig.json and tsconfig.tests.json)"
	@echo "clippy         cargo clippy --workspace --all-targets -D warnings"
	@echo "idl            fail if src/idl and commons/idls copies differ"
	@echo "clean          dist/ and Cargo target/"

check: check-ts check-rust

check-ts: fmt-check-ts typecheck

check-rust: fmt-check-rust clippy idl

fmt: fmt-ts fmt-rust

fmt-ts:
	pnpm format:fix

fmt-rust:
	cargo fmt

fmt-check: fmt-check-ts fmt-check-rust

fmt-check-ts:
	pnpm format

fmt-check-rust:
	cargo fmt --check

clippy:
	cargo clippy --workspace --all-targets $(CARGO_LOCKED) -- -D warnings

idl:
	diff src/idl/dlmm-pro/dlmm_pro.json commons/idls/dlmm_pro.json

typecheck:
	pnpm typecheck

test: test-ts test-rust

test-ts:
	pnpm test

test-rust:
	cargo test --workspace $(CARGO_LOCKED)

build:
	pnpm build

build-rust:
	cargo build --workspace $(CARGO_LOCKED)

clean:
	rm -rf dist
	cargo clean

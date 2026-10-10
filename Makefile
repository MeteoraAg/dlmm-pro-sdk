.DEFAULT_GOAL := help

.PHONY: help fmt-check-ts typecheck test-ts build fmt-check-rs clippy test-rs idl check test

help:
	@echo "fmt-check-ts   prettier --check"
	@echo "typecheck      tsc (tsconfig.json and tsconfig.tests.json)"
	@echo "test-ts        vitest run"
	@echo "build          TypeScript package (tsup + dts)"
	@echo "fmt-check-rs   cargo fmt --all --check"
	@echo "clippy         cargo clippy --workspace --locked -D warnings"
	@echo "test-rs        cargo test --workspace --locked"
	@echo "idl            diff src/idl and commons/idls copies"
	@echo "check          TypeScript checks, rustfmt, clippy, IDL diff"
	@echo "test           vitest and cargo test"

fmt-check-ts:
	pnpm format

typecheck:
	pnpm typecheck

test-ts:
	pnpm test

build:
	pnpm build

fmt-check-rs:
	cargo fmt --all -- --check

clippy:
	cargo clippy --workspace --all-targets --locked -- -D warnings

test-rs:
	cargo test --workspace --locked

idl:
	diff -q src/idl/dlmm-pro/dlmm_pro.json commons/idls/dlmm_pro.json

check: fmt-check-ts typecheck fmt-check-rs clippy idl

test: test-ts test-rs

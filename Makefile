# TypeScript entry points. Rust checks live in .github/workflows/commons.yml.

.DEFAULT_GOAL := help

.PHONY: help fmt-check-ts typecheck test-ts build

help:
	@echo "fmt-check-ts   prettier --check"
	@echo "typecheck      tsc (tsconfig.json and tsconfig.tests.json)"
	@echo "test-ts        vitest run"
	@echo "build          TypeScript package (tsup + dts)"

fmt-check-ts:
	pnpm format

typecheck:
	pnpm typecheck

test-ts:
	pnpm test

build:
	pnpm build

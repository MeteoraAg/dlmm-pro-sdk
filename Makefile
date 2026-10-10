.DEFAULT_GOAL := help

.PHONY: help fmt-check-ts typecheck test-ts build check test

help:
	@echo "fmt-check-ts   prettier --check"
	@echo "typecheck      tsc (tsconfig.json and tsconfig.tests.json)"
	@echo "test-ts        vitest run"
	@echo "build          TypeScript package (tsup + dts)"
	@echo "check          prettier and tsc"
	@echo "test           vitest"

fmt-check-ts:
	pnpm format

typecheck:
	pnpm typecheck

test-ts:
	pnpm test

build:
	pnpm build

check: fmt-check-ts typecheck

test: test-ts

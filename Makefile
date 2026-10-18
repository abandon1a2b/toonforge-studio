.PHONY: build test dev
build:
	cd resource && npm ci && npm run build
	go build -trimpath -o bin/toonforge ./cmd/toonforge
test:
	go test ./...
	cd resource && npm run test && npm run typecheck
dev:
	go run ./cmd/toonforge --root "$${TOONFORGE_ROOT:-/Users/one/Desktop/toonforge}" serve --port 8795 --dev

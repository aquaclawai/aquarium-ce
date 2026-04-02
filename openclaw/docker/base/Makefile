# =============================================================================
# OpenClaw Gateway — Base Image Build & Run Targets
# =============================================================================
# Build context is openclaw/ (two levels up from docker/base/).
# The Dockerfile references paths relative to openclaw/:
#   docker/templates/*.md, docker/base/docker-entrypoint.sh, plugin/
# =============================================================================

OPENCLAW_VERSION ?= 2026.3.28
PLATFORM_REV ?=
IMAGE_NAME ?= ghcr.io/aquaclawai/openclaw
IMAGE_TAG ?= $(if $(PLATFORM_REV),$(OPENCLAW_VERSION)-$(PLATFORM_REV),$(OPENCLAW_VERSION))
REGISTRY ?=
FULL_IMAGE = $(if $(REGISTRY),$(REGISTRY)/,)$(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: build push run stop login health clean help

build:
	docker build \
		--build-arg OPENCLAW_VERSION=$(OPENCLAW_VERSION) \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		-t $(IMAGE_NAME):latest \
		-f Dockerfile \
		../..

push:
	docker push $(IMAGE_NAME):$(IMAGE_TAG)
	docker push $(IMAGE_NAME):latest

run:
	docker run -d \
		--name openclaw-gateway \
		--init \
		-p 18789:18789 \
		-p 18790:18790 \
		-v openclaw-data:/home/node/.openclaw \
		-e OPENCLAW_GATEWAY_TOKEN=$$(openssl rand -hex 32) \
		$(IMAGE_NAME):$(IMAGE_TAG)
	@echo "Gateway started. Token printed above."
	@echo "Open http://localhost:18789"

stop:
	docker stop openclaw-gateway 2>/dev/null || true
	docker rm openclaw-gateway 2>/dev/null || true

login:
	docker run -it --rm \
		-v openclaw-data:/home/node/.openclaw \
		$(IMAGE_NAME):$(IMAGE_TAG) \
		login

health:
	curl -sf http://localhost:18789/ > /dev/null && echo "OK" || echo "FAIL"

clean:
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) $(IMAGE_NAME):latest 2>/dev/null || true
	docker volume rm openclaw-data 2>/dev/null || true

help:
	@echo "Targets:"
	@echo "  build   — Build Docker image (OPENCLAW_VERSION=$(OPENCLAW_VERSION))"
	@echo "  push    — Push to Docker Hub (aquaclaw/openclaw)"
	@echo "  run     — Run gateway with auto-generated token"
	@echo "  stop    — Stop and remove gateway container"
	@echo "  login   — Interactive WhatsApp QR login"
	@echo "  health  — Check gateway health"
	@echo "  clean   — Remove image and data volume"

OPENCLAW_VERSION ?= 2026.2.12
PLATFORM_REV ?= p1
BASE_IMAGE ?= europe-west1-docker.pkg.dev/jinko-agent/agent-docker-repo/openclaw-gateway
IMAGE_NAME ?= openclaw-gateway-clawra
IMAGE_TAG ?= $(OPENCLAW_VERSION)-$(PLATFORM_REV)
CLAWRA_VERSION ?= main
REGISTRY ?=
FULL_IMAGE = $(if $(REGISTRY),$(REGISTRY)/,)$(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: build push clean help

build:
	docker build \
		--build-arg BASE_IMAGE=$(BASE_IMAGE) \
		--build-arg BASE_TAG=$(IMAGE_TAG) \
		--build-arg CLAWRA_VERSION=$(CLAWRA_VERSION) \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		-t $(IMAGE_NAME):latest \
		.

push:
	@test -n "$(REGISTRY)" || (echo "ERROR: Set REGISTRY=your.registry.io" && exit 1)
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(FULL_IMAGE)
	docker push $(FULL_IMAGE)

clean:
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) $(IMAGE_NAME):latest 2>/dev/null || true

help:
	@echo "Targets:"
	@echo "  build   — Build Clawra image (BASE=$(BASE_IMAGE):$(OPENCLAW_VERSION))"
	@echo "  push    — Push to registry (REGISTRY=your.registry.io)"
	@echo "  clean   — Remove image"

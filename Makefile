# vChat: everyday commands.  Run `make` (or `make help`) to see them all.
#
# Run it from Git Bash on Windows (it has make). The deploy SSH key lives in WSL; from Git Bash
# the Makefile reads it from there and uses Windows' own ssh (WSL's network stalls on bigger
# transfers over the office VPN). Without that it hops into WSL. Running it inside WSL works too.
#
# Values you may override:  make logs SERVICE=web LINES=500

SHELL := bash
.DEFAULT_GOAL := help

# This file is for the laptop. On the app server (where deploy/.env exists) say what to use instead.
ifneq ($(wildcard deploy/.env),)
  $(info This is the laptop's Makefile. On the server use the one in deploy/:)
  $(info )
  $(info    cd ~/vchat/deploy && make           (lists the server commands))
  $(info    cd ~/vchat/deploy && make deploy    (take the code the laptop sent, rebuild, migrate))
  $(info )
  $(info New code comes from the laptop: `make deploy` there tests, pushes and ships it.)
  $(error stopped)
endif

HOST    ?= hashai@10.10.11.6
KEY     ?= ~/.ssh/github_actions_key
SITE    ?= https://vchat.ssmm.online
BRANCH  ?= master
SERVICE ?= backend
LINES   ?= 200

SSH_OPTS := -o BatchMode=yes -o ServerAliveInterval=30
SSH      := ssh -i $(KEY) $(SSH_OPTS) $(HOST)
SSH_TTY  := ssh -t -i $(KEY) -o ServerAliveInterval=30 $(HOST)
COMPOSE  := cd ~/vchat/deploy && docker compose

# Local Python: the backend's own virtualenv (Windows or Linux layout).
PY     := $(abspath $(firstword $(wildcard backend/.venv/Scripts/python.exe backend/.venv/bin/python)))
DJANGO := cd backend && DJANGO_DEBUG=1 $(PY) manage.py

# Server steps need the SSH key that lives in WSL. DIRECT: ssh from here (inside WSL, or from
# Git Bash with the key read from WSL's disk). Otherwise `server` re-runs the target inside WSL.
IN_WSL := $(shell grep -qi microsoft /proc/version 2>/dev/null && echo 1)
WIN_DIR := $(shell cygpath -w "$(CURDIR)" 2>/dev/null)
ifneq ($(IN_WSL),1)
  WSL_KEY := $(shell wsl -e sh -c 'wslpath -w $$HOME/.ssh/github_actions_key' 2>/dev/null | tr -d '\r' | tr '\134' '/')
  ifneq ($(wildcard $(WSL_KEY)),)
    KEY := $(WSL_KEY)
    DIRECT := 1
  endif
else
  DIRECT := 1
endif
SSH      := ssh -i $(KEY) $(SSH_OPTS) $(HOST)
SSH_TTY  := ssh -t -i $(KEY) -o ServerAliveInterval=30 $(HOST)
ifeq ($(DIRECT),1)
  server     = $(SSH) $(1)
  server_tty = $(SSH_TTY) $(1)
else
  server     = wsl --cd "$(WIN_DIR)" make --no-print-directory $@ SERVICE="$(SERVICE)" LINES="$(LINES)" SERVICES="$(SERVICES)" KEYNAME="$(KEYNAME)"
  server_tty = $(server)
endif

.PHONY: sync _sync-only help install dev-api dev-web migrate migrations shell test lint typecheck check deploy deploy-web deploy-api _clean-tree _bundle _ship status ps logs logs-f version env-keys restart ssh server-shell createsuperuser purge-dry purge backup backups set-env
help: ## Show this list
	@echo "vChat commands (make <name>):"
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /|/' | awk -F'|' '{ printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2 }'


# --- local development ---
install: ## Install backend and web dependencies
	cd backend && $(PY) -m pip install -r requirements.txt -r requirements-dev.txt
	cd web && npm ci

dev-api: ## Run the API locally on :8100 (debug)
	$(DJANGO) runserver 127.0.0.1:8100

dev-web: ## Run the website locally on :3100 against the local API
	cd web && BACKEND_URL=http://127.0.0.1:8100 NEXT_PUBLIC_WS_URL=ws://localhost:8100 npx next dev -p 3100

migrate: ## Apply database migrations locally
	$(DJANGO) migrate

migrations: ## Make new migrations after model changes (local)
	$(DJANGO) makemigrations

shell: ## Django shell on the local database
	$(DJANGO) shell

test: ## Backend tests
	cd backend && DJANGO_DEBUG=1 $(PY) -m pytest -q -p no:cacheprovider

lint: ## Website lint (ESLint)
	cd web && npx eslint src --quiet

typecheck: ## Website type check (TypeScript)
	cd web && npx tsc --noEmit -p .

check: test lint typecheck ## Everything that must pass before a deploy


# --- deploy ---
deploy: _clean-tree check _bundle ## Checks, then ship everything (backend + web + migrations), then verify
	@$(MAKE) --no-print-directory _ship SERVICES=
	@$(MAKE) --no-print-directory status

deploy-web: _clean-tree lint typecheck _bundle ## Ship only the website (no backend restart, no migrations)
	@$(MAKE) --no-print-directory _ship SERVICES=web
	@$(MAKE) --no-print-directory status

deploy-api: _clean-tree test _bundle ## Ship only the backend (runs migrations)
	@$(MAKE) --no-print-directory _ship SERVICES="migrate backend"
	@$(MAKE) --no-print-directory status

sync: _clean-tree _bundle ## Send the code to the server without rebuilding anything (Makefiles, docs, scripts)
ifeq ($(DIRECT),1)
	scp -i $(KEY) $(SSH_OPTS) .deploy.bundle $(HOST):/tmp/vchat.bundle
	rm -f .deploy.bundle
	$(SSH) 'cd ~/vchat && git pull -q origin $(BRANCH) && git log --oneline -1'
else
	@wsl --cd "$(WIN_DIR)" make --no-print-directory _sync-only
endif

_sync-only:
	scp -i $(KEY) $(SSH_OPTS) .deploy.bundle $(HOST):/tmp/vchat.bundle
	rm -f .deploy.bundle
	$(SSH) 'cd ~/vchat && git pull -q origin $(BRANCH) && git log --oneline -1'

_clean-tree:
	@test "$$(git rev-parse --abbrev-ref HEAD)" = "$(BRANCH)" || { echo "Not on $(BRANCH)."; exit 1; }
	@test -z "$$(git status --porcelain --untracked-files=no)" || { echo "Uncommitted changes: commit them first."; git status --short --untracked-files=no; exit 1; }

_bundle:
	git push -q origin $(BRANCH)
	git bundle create .deploy.bundle $(BRANCH)

_ship:
ifeq ($(DIRECT),1)
	scp -i $(KEY) $(SSH_OPTS) .deploy.bundle $(HOST):/tmp/vchat.bundle
	rm -f .deploy.bundle
	$(SSH) 'cd ~/vchat && git pull -q origin $(BRANCH) && git log --oneline -1 && cd deploy && docker compose up -d --build $(SERVICES) > ~/vchat-up.log 2>&1; echo "UP=$$?"; tail -3 ~/vchat-up.log; docker compose logs --no-log-prefix migrate 2>&1 | grep -E "Applying|No migrations" | tail -5'
else
	@$(call server)
endif


# --- production: look ---
status: ## Production check: main pages and the API answer
	@for i in $$(seq 45); do [ "$$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 $(SITE)/api/health/)" = 200 ] && break; sleep 2; done  # a fresh deploy needs a few seconds
	@for p in "" chat chat/stranger chat/me api/health/; do printf "  %-16s %s\n" "/$$p" "$$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 $(SITE)/$$p)"; done
	@echo "  /api/gifs/ without login -> $$(curl -s -o /dev/null -w '%{http_code}' $(SITE)/api/gifs/) (401 is right)"

ps: ## Containers on the server
	$(call server,'$(COMPOSE) ps --format "{{.Service}}\t{{.Status}}"')

logs: ## Last LINES lines of SERVICE's log (default: backend)
	$(call server,'$(COMPOSE) logs --no-log-prefix --tail $(LINES) $(SERVICE)')

logs-f: ## Follow SERVICE's log live (Ctrl+C to stop)
	$(call server_tty,'$(COMPOSE) logs --no-log-prefix --tail 50 -f $(SERVICE)')

version: ## Which commits are running on the server
	$(call server,'cd ~/vchat && git log --oneline -3')

env-keys: ## Names in the server .env (never the values)
	$(call server,'grep -E "^[A-Z_]+=" ~/vchat/deploy/.env | cut -d= -f1 | sort')


# --- production: do ---
restart: ## Restart SERVICE on the server (backend, web, nginx, turn...)
	$(call server,'$(COMPOSE) restart $(SERVICE) && $(COMPOSE) ps $(SERVICE)')

ssh: ## Open a shell on the app server
	$(call server_tty,)

server-shell: ## Django shell on the PRODUCTION database (careful)
	$(call server_tty,'$(COMPOSE) exec backend python manage.py shell')

createsuperuser: ## Make an admin login for /admin/ on production
	$(call server_tty,'$(COMPOSE) exec backend python manage.py createsuperuser')

purge-dry: ## What the privacy purge would delete now (deletes nothing)
	$(call server,'$(COMPOSE) exec -T backend python manage.py purge_old_data --dry-run')

purge: ## Run the privacy purge now (it also runs hourly)
	$(call server,'$(COMPOSE) exec -T backend python manage.py purge_old_data')

backup: ## Back up the database and media now (same as the nightly job)
	$(call server,'BACKUP_DIR=$$HOME/vchat-data/backups sh $$HOME/vchat/deploy/backup.sh')

backups: ## List the backups on the server
	$(call server,'ls -lht $$HOME/vchat-data/backups | head -20')

set-env: ## Change one server .env value, e.g. make set-env KEYNAME=FREE_FOR_ALL (asks for it; backs up .env; restarts)
ifeq ($(DIRECT),1)
	@test -n "$(KEYNAME)" || { echo "Usage: make set-env KEYNAME=NAME"; exit 1; }
	@read -r -s -p "New value for $(KEYNAME) (hidden): " VALUE; echo; \
	  printf '%s\n' "$$VALUE" | $(SSH) 'cd ~/vchat/deploy && IFS= read -r V && cp -p .env ".env.bak-$$(date +%Y%m%d-%H%M%S)" && sed -i "/^$(KEYNAME)=/d" .env && printf "%s=%s\n" "$(KEYNAME)" "$$V" >> .env && chmod 600 .env && echo "$(KEYNAME) set (old .env backed up)" && docker compose up -d backend web > /dev/null 2>&1 && echo "backend and web restarted"'
else
	@$(call server)
endif


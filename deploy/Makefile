# vChat on the app server: everyday commands.  Log in, then:
#
#     cd ~/vchat/deploy && make            (lists everything)
#
# Values you may override:  make logs SERVICE=web LINES=500
# (Deploying is done from the laptop: `make deploy` in the repo root. `make update` here only
#  applies a bundle that was already uploaded to /tmp/vchat.bundle.)

SHELL := bash
.DEFAULT_GOAL := help

SERVICE ?= backend
LINES   ?= 200
BACKUPS ?= $(HOME)/vchat-data/backups
DC      := docker compose

.PHONY: help status ps logs logs-f errors stats version env-keys disk restart up up-web up-api update shell dbshell migrate showmigrations createsuperuser purge-dry purge purge-log backup backups backup-log env-edit clean
help: ## Show this list
	@echo "vChat server commands (make <name>), run in ~/vchat/deploy:"
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /|/' | awk -F'|' '{ printf "  \033[1m%-15s\033[0m %s\n", $$1, $$2 }'


# --- look ---
status: ## Containers, running commit and disk space
	@$(DC) ps --format "{{.Service}}\t{{.Status}}"
	@echo; cd .. && git log --oneline -1
	@echo; df -h / | tail -1 | awk '{ print "disk: " $$3 " used of " $$2 " (" $$5 ")" }'

ps: ## Containers and their health
	$(DC) ps

logs: ## Last LINES lines of SERVICE's log (backend, web, nginx, postgres, redis, turn)
	$(DC) logs --no-log-prefix --tail $(LINES) $(SERVICE)

logs-f: ## Follow SERVICE's log live (Ctrl+C to stop)
	$(DC) logs --no-log-prefix --tail 50 -f $(SERVICE)

errors: ## Errors and tracebacks in the backend log (last 2000 lines)
	@$(DC) logs --no-log-prefix --tail 2000 backend 2>&1 | grep -iE -B2 -A8 'traceback|error|exception' | tail -$(LINES) || echo "no errors"

stats: ## CPU and memory per container right now
	docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

version: ## Last commits on this server
	cd .. && git log --oneline -5

env-keys: ## Names in .env (never the values)
	@grep -E '^[A-Z_]+=' .env | cut -d= -f1 | sort

disk: ## Disk use: the machine, Docker, backups
	@df -h / | tail -1
	@echo
	@docker system df
	@echo
	@du -sh $(BACKUPS) 2>/dev/null || true


# --- run ---
restart: ## Restart SERVICE (no rebuild)
	$(DC) restart $(SERVICE)
	@$(DC) ps $(SERVICE)

up: ## Rebuild and start everything from the current code (runs migrations)
	$(DC) up -d --build
	@$(DC) logs --no-log-prefix migrate 2>&1 | grep -E 'Applying|No migrations' | tail -5
	@$(DC) ps --format "{{.Service}}\t{{.Status}}"

up-web: ## Rebuild and restart only the website
	$(DC) up -d --build web
	@$(DC) ps web

up-api: ## Rebuild and restart only the backend (runs migrations)
	$(DC) up -d --build migrate backend
	@$(DC) logs --no-log-prefix migrate 2>&1 | grep -E 'Applying|No migrations' | tail -5

update: ## Apply the bundle uploaded to /tmp/vchat.bundle, then rebuild everything
	cd .. && git pull -q origin master && git log --oneline -1
	@$(MAKE) --no-print-directory up


# --- Django ---
shell: ## Django shell on the production database (careful)
	$(DC) exec backend python manage.py shell

dbshell: ## psql on the production database (careful)
	$(DC) exec postgres psql -U vchat vchat

migrate: ## Apply migrations now
	$(DC) exec -T backend python manage.py migrate

showmigrations: ## Which migrations are applied
	$(DC) exec -T backend python manage.py showmigrations | grep -E '^\w|\[ \]'

createsuperuser: ## Make an admin login for /admin/
	$(DC) exec backend python manage.py createsuperuser

purge-dry: ## What the privacy purge would delete now (deletes nothing)
	$(DC) exec -T backend python manage.py purge_old_data --dry-run

purge: ## Run the privacy purge now (cron runs it hourly)
	$(DC) exec -T backend python manage.py purge_old_data

purge-log: ## Last runs of the hourly purge
	tail -$(LINES) $(HOME)/vchat-data/purge.log


# --- backups and upkeep ---
backup: ## Back up the database and media now (same as the 02:30 job)
	BACKUP_DIR=$(BACKUPS) sh ./backup.sh

backups: ## List the backups, newest first
	@ls -lht $(BACKUPS) | head -20

backup-log: ## Last lines of the nightly backup log
	tail -$(LINES) $(BACKUPS)/backup.log

env-edit: ## Edit .env (backs it up first; then run make up)
	cp -p .env .env.bak-$$(date +%Y%m%d-%H%M%S)
	$${EDITOR:-nano} .env
	@chmod 600 .env; echo "Saved. Apply it with: make up"

clean: ## Free disk: remove dangling Docker images and build cache (keeps everything in use)
	docker image prune -f
	docker builder prune -f --filter until=168h


# Staging validation

- Machine: Ubuntu 24.04.5 LTS, 4 processors, 15983 MB RAM
- Docker: Docker version 29.9.3
- Scope: stopped after section 5
- Result: **36 passed, 0 failed, 0 skipped**
- Known defects in optional components: 0 (not counted above; listed where they occur)

This was the FAST prerequisites job. It stops after section 5 and is
not a full validation: Realtime, storage, backups and cron were not run.

No production credential was used. Every secret here was generated on
this machine and dies with it.

## 1. The machine
      Ubuntu 24.04.5 LTS  (noble)
      4 processors, 15983 MB RAM, 86 GB free on /
- PASS running on Ubuntu, which is what bootstrap.sh supports
      Docker is pre-installed; removing it so the install path is genuinely tested
- PASS starting from a machine with no Docker

## 2. bootstrap.sh installs Docker and the Compose plugin
- PASS bootstrap.sh completed
- PASS Docker Engine installed and responding: Docker version 29.9.3
- PASS Compose plugin installed: 5.7.0
- PASS installed from Docker's official apt repository (docker-ce)
- PASS bootstrap verified nothing unexpected is publicly exposed

## 3. The shared stack
- PASS central-postgres is running
- PASS central-caddy is running
- PASS central-postgres reports healthy
- PASS PostgreSQL answers queries
      version: PostgreSQL 17.6 on x86_64-pc-linux-gnu, compi
- PASS postgres config generated for this machine, no placeholders left
      max_connections=150  shared_buffers=3955MB  work_mem=9MB
- PASS wal_level is logical, which Realtime requires
- PASS the image's preloaded libraries survived the config override
- PASS pg_cron is preloaded
- PASS the central.applications registry exists
- PASS PostgreSQL is bound to 127.0.0.1 only
- PASS the stack is up, so the remaining checks can mean something

## 4. Startup, health, restart recovery and resource usage
      restarting central-postgres to check it recovers unattended
- PASS central-postgres returned to healthy after a restart
- PASS it answers queries again after the restart
- PASS restart policy is unless-stopped, so it survives a reboot

## 5. Two independent applications, and isolation between them
- PASS provisioned alpha_shop (realtime + storage, no auth)
- PASS provisioned beta_shop (auth, no realtime or storage)
- PASS alpha_shop's profiles are 'realtime,storage' — no auth, as measured
- PASS beta_shop's profiles are 'auth' — auth only
- PASS alpha_shop's compose configuration is valid, so every service it uses can start
- PASS beta_shop's compose configuration is valid, so every service it uses can start
- PASS beta_shop's database has an auth schema
- PASS alpha_shop's database has NO auth schema — nothing provisioned that it does not use
- PASS alpha_shop's credentials open alpha_shop's own database
- PASS beta_shop's credentials open beta_shop's own database
- PASS beta_shop's credentials are REFUSED by alpha_shop's database
- PASS beta_shop cannot read alpha_shop's data
- PASS the two applications have different JWT secrets
- PASS alpha_shop/.env is mode 600
- PASS beta_shop/.env is mode 600

## Sections 6 onwards
- NOT RUN: this job was asked to stop after section 5

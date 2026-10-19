# Mission F — Bank Lab Teardown & Clean-State Procedure
#
# All synthetic, local-only. Lab resources are prefixed `vardhan_banklab_`
# (containers), `banklab*` (network/volumes), and host ports 18081–18084 /
# 18200. Nothing outside that scope is touched.

## Normal teardown (default: `run_bank_lab.sh` tears down unless `--keep`)

```sh
cd /Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main
docker compose -f research/bank_lab/docker-compose.bank-lab.yml down -v
```

`down -v` removes all lab containers AND the four named volumes
(`banklab-*-data`), giving a clean state for the next run.

## Verify clean state

```sh
# No banklab containers remain:
docker ps -a --filter 'name=vardhan_banklab' --format '{{.Names}}'
# (expect empty output)

# No banklab volumes remain:
docker volume ls --filter 'name=banklab'
# (expect empty output)

# Host ports released:
lsof -i :18081,:18082,:18083,:18084,:18200
# (expect no listeners)
```

## Scoped volume prune (only if `down -v` was skipped)

```sh
docker volume rm banklab-hsbc-data banklab-jpmorgan-data banklab-lgt-data banklab-swift-data
```

Do NOT run unscoped `docker volume prune` / `docker system prune` — those
delete resources belonging to other projects.

## Verify no secrets on disk

The lab deliberately stores no secrets on disk:

- No secret files are mounted into any service (the PoV entrypoint falls
  back to its synthetic lab-only default admin password in-memory).
- The Vault dev token (`banklab-dev-root`) lives only in compose env and
  the throwaway dev server's memory (`-dev` mode, no persistence).
- `research/bank_lab/attacker/results/*.json` (gitignored at runtime) holds
  only status codes, counts, and key-version prefixes — never tokens,
  passwords, or ciphertext bodies.

Verify:

```sh
grep -rEi 'BANKLAB_ADMIN_PASS|banklab-dev-root|P0V-Str0ng' \
  research/bank_lab/attacker/results/ || echo "clean: no secrets in results"
```

## Fresh rerun

```sh
./research/bank_lab/run_bank_lab.sh
```

Every run creates fresh orgs with a deterministic per-profile seed, so
results are reproducible without carrying state between runs.

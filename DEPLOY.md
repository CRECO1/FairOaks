# 🚑 CANONICAL DEPLOY TARGET — READ BEFORE DEPLOYING

The Fair Oaks CRM has been clobbered repeatedly by deploys from the wrong
folder/branch. Follow this exactly. **Deploying wrong overwrites live work.**

## The CRM (fairoaksrealtygroup.com)

| Thing | Value |
|-------|-------|
| **Vercel project name** | `fair-oaks-realty-group` |
| **Vercel project ID** | `prj_cqyAaKUBZhvV6wEgzktrs9nKmyNy` |
| **Vercel team/org** | `zack-5724s-projects` (`team_89BiPrXgLfsDx2UcTvPI7LLJ`) |
| **Live domain** | https://fairoaksrealtygroup.com (+ www) |
| **GitHub repo** | `CRECO1/FairOaks` |
| **Deploy ONLY from folder** | `/Users/creco/Documents/CRECO/FairOaks-consolidate` |
| **Canonical branch** | `consolidate/props-plus-calls` |

### Deploy procedure (the ONLY approved way)
```bash
cd /Users/creco/Documents/CRECO/FairOaks-consolidate
git add -A && git commit -m "…" && git push      # ALWAYS back up FIRST
vercel --prod --yes                              # then deploy
```

## ❌ DO NOT
- **Do NOT deploy from `/Users/creco/Documents/CRECO/FairOaks`** — it's the SAME
  Vercel project but on branch `security-fixes-aug2026`; deploying it overwrites
  the live CRM with different code.
- **Do NOT deploy to** `project-fairoaks`, `fair-oaks`, or `fair-oaks-m5tg` —
  stray duplicate projects, NOT the live domain.
- **Do NOT deploy from two machines.** Pick ONE (this Mac **or** the Mac mini at
  `/Volumes/MacMini HD`), never both. Whoever deploys last wins.
- **Do NOT run `vercel --prod` with uncommitted changes.** Commit + push first,
  every time. Work deployed but not committed has been lost permanently before.

## Separate site — the CRECO website (do not confuse with the CRM)
| Thing | Value |
|-------|-------|
| Vercel project | `creco` |
| Live domain | https://crecotx.com |
| GitHub repo | `CRECO1/CRECOWEBSITE` |
| Local folder | `/Users/creco/Documents/CRECO/CRECOWEBSITE` |

Note: CRECO and Fair Oaks (FORG) are **separate Supabase projects**. The CRM
tables live on FORG; the CRECO site writes leads to FORG via
`CRM_SUPABASE_URL` / `CRM_SUPABASE_SERVICE_ROLE_KEY`.

## Prerequisite
Git requires **Full Disk Access** for the Claude app (System Settings → Privacy
& Security → Full Disk Access), or `FairOaks/.git` is macOS-locked and every git
command fails with `Operation not permitted`.

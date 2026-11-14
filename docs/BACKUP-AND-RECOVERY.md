# EffDesk off-site backup and recovery

This workflow creates an encrypted snapshot of the Neon PostgreSQL database and the Netlify Blobs `attachments` store, then uploads the archive to a private Cloudflare R2 bucket every six hours. It is deliberately separate from Netlify deploys. It does not change production data.

## What is included

- A PostgreSQL custom-format dump made with `pg_dump` (all schemas and rows visible to the backup database role).
- Every key/value object in the Netlify Blobs site-wide store named `attachments`, including ticket attachments, inbound-email attachments, inline images, and help-center images.
- A manifest with original blob keys, sizes, and SHA-256 hashes.

The archive is encrypted with age before it leaves the GitHub Actions runner. The age private key must stay offline; only its public recipient is stored in GitHub.

## One-time setup

### 1. Create the R2 bucket

In Cloudflare, open **Storage & databases → R2 → Overview → Create bucket**. Use a private bucket such as `effdesk-backups`. Do not enable public access or create a public bucket domain.

Create an R2 API token with **Object Read & Write**, restricted to this bucket only. Record its Access Key ID and Secret Access Key. The workflow does not need bucket-administration permissions.

### 2. Create an encryption key

Install age on a trusted computer and generate a key pair:

```sh
age-keygen -o effdesk-backup.agekey
```

Keep `effdesk-backup.agekey` offline in at least two secure places. Never upload it to GitHub, Netlify, or R2. The command prints a public recipient beginning with `age1`; store that public recipient in GitHub as `BACKUP_AGE_RECIPIENT`.

### 3. Add GitHub Actions secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Neon **direct** (non-pooled) connection string for the production database; use a read-only backup role if your Neon/RLS configuration permits a complete dump |
| `NETLIFY_SITE_ID` | Netlify Project ID for the production EffDesk site |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token with access to that site's Blobs store |
| `BACKUP_AGE_RECIPIENT` | Public age recipient from step 2 (not the private key) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_BUCKET` | R2 bucket name |
| `R2_ACCESS_KEY_ID` | R2 token Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 token Secret Access Key |

Use the production Netlify Project ID. Netlify Blobs access requires both the site ID and a token when the workflow runs outside Netlify. Do not put any of these secrets in source files or workflow logs.

**Important database-role check:** a PostgreSQL dump only contains rows the connected role can read. Before relying on this backup, verify that the chosen direct Neon role can read every tenant's rows under the platform's RLS policies. Prefer a dedicated, least-privilege backup role explicitly granted the necessary read access, rather than assuming an ordinary tenant-scoped application role can dump all customer data.

## Run and verify

After adding all secrets, open **Actions → Encrypted off-site backups → Run workflow**. The scheduled workflow also runs every six hours. A successful run uploads two objects under a unique UTC path:

- `effdesk/YYYY/MM/DD/HHMMSS/backup.tar.gz.age`
- `effdesk/YYYY/MM/DD/HHMMSS/backup.tar.gz.age.sha256`

Check the GitHub Actions run and confirm both objects exist in the private R2 bucket. A green workflow is not a restore test.

## Isolated restore drill

**Never perform a test restore against the production Neon database or production Netlify site.** Use a new, empty Neon project/database and a separate Netlify site so the drill cannot overwrite live data.

### 1. Prepare isolated recovery targets

1. In Neon, create a separate project for recovery testing. Create or use its empty database and copy its **direct** connection string. Keep it private; do not add it to the production GitHub secrets.
2. In Netlify, create a separate site for the recovery test. It can be a temporary site; note its Site ID. Do not reuse the production Site ID.
3. Keep the recovery database URL, recovery Site ID, and recovery Netlify token in local environment variables only. Never paste them into chat or commit them.

### 2. Download and decrypt a backup

In Cloudflare R2, open the private backup bucket and navigate to the timestamped `effdesk/YYYY/MM/DD/HHMMSS/` folder. Download both `backup.tar.gz.age` and `backup.tar.gz.age.sha256` to a trusted computer, alongside the offline `effdesk-backup.agekey` file.

Install the local tools if needed (macOS with Homebrew):

```sh
brew install age libpq
```

Verify and decrypt the exact downloaded archive:

```sh
shasum -a 256 -c backup.tar.gz.age.sha256
age --decrypt --identity effdesk-backup.agekey --output backup.tar.gz backup.tar.gz.age
mkdir -p effdesk-restore-test
tar -xzf backup.tar.gz -C effdesk-restore-test
```

The checksum file contains the encrypted archive's digest. If verification or decryption fails, stop; do not attempt a restore.

### 3. Restore PostgreSQL into the isolated Neon project

Install PostgreSQL client tools if `pg_restore` is not available. Set the recovery connection string in your local terminal (do not use the production URL):

```sh
export RECOVERY_DATABASE_URL='YOUR_ISOLATED_NEON_DIRECT_CONNECTION_STRING'
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error \
  --dbname="$RECOVERY_DATABASE_URL" \
  effdesk-restore-test/effdesk-backup/database.dump
```

**Destructive-target warning:** `--clean --if-exists` drops objects in the target database before recreating them. Run this only against the new, isolated recovery database. Review the connection string before pressing Enter.

### 4. Restore attachments into the isolated Netlify site

From a local checkout of the EffDesk repository at the commit you are restoring, install dependencies with `npm ci`. Then set only the recovery site's credentials:

```sh
export NETLIFY_SITE_ID='YOUR_RECOVERY_NETLIFY_SITE_ID'
export NETLIFY_AUTH_TOKEN='YOUR_NETLIFY_TOKEN'
BACKUP_RESTORE_CONFIRM=RESTORE_BLOBS \
  node scripts/restore-blobs.js \
  effdesk-restore-test/effdesk-backup/blobs
```

The restore utility verifies the manifest, every object's size and SHA-256, and the aggregate byte count before writing any objects. It restores original keys into the selected `attachments` store. Do not point it at the production site.

### 5. Validate recovery

- Confirm PostgreSQL restore completed without errors and that expected application tables and migrations exist.
- Deploy the matching EffDesk code to the temporary Netlify site and configure it to use the isolated Neon database and the recovery site's Blobs store.
- Sign in using a test account available in the restored database.
- Confirm at least one known ticket, its conversation/history, and its attachment can be opened.
- Confirm help-center images and other stored files load.
- Verify two different organizations remain separated; use test accounts from each tenant if available.
- Record the backup timestamp, restore duration, any missing data, and any manual steps needed.

A successful drill demonstrates that this specific backup can be restored. It does not by itself prove every tenant's rows were included; separately verify that the backup database role can read all tenant data under the platform's RLS configuration.

## Retention and ransomware protection

Configure an R2 lifecycle rule for the `effdesk/` prefix after choosing a retention period appropriate to your legal and customer obligations. A reasonable starting point is 30 days of six-hour backups, but storage use depends on database and attachment size. Do not configure deletion until you have verified successful backups and a restore.

For stronger ransomware resistance, configure an R2 bucket-lock retention rule in Cloudflare for backup objects and keep bucket administration credentials separate from the workflow's object-writer token. Bucket lock can prevent deletion or overwrite during the retention window. Test the exact policy on a disposable bucket first; locked objects cannot be deleted until the lock expires.

Keep at least one offline copy of the age private key and periodically copy a known-good encrypted backup to offline storage. Neon point-in-time recovery is a useful fast-recovery layer, not a substitute for these independent backups.

## Limitations

- This workflow is not active until the GitHub secrets are configured and a scheduled or manual run succeeds.
- It backs up the production `attachments` Netlify Blobs store and the PostgreSQL database; it does not back up Netlify site configuration, environment secrets, DNS, or customer-owned external systems.
- The workflow uploads a full database and full blob snapshot every six hours. R2 storage consumption and GitHub Actions runtime should be monitored as the dataset grows.
- A successful upload verifies transfer, not full recoverability. Schedule periodic isolated restore drills.

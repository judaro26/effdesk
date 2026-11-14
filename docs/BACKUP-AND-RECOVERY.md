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

## Restore procedure

Perform recovery into a new, isolated Neon database and a separate Netlify site/store first. Do not test restoration against production.

1. Download the encrypted archive and checksum from R2.
2. Verify the encrypted file with `sha256sum -c backup.tar.gz.age.sha256`.
3. Decrypt it on a trusted computer with the offline private key: `age --decrypt --identity effdesk-backup.agekey --output backup.tar.gz backup.tar.gz.age`.
4. Extract the archive: `tar -xzf backup.tar.gz`.
5. Restore the database dump into the isolated recovery database using `pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RECOVERY_DATABASE_URL" effdesk-backup/database.dump`. Review the target connection string carefully before running this command.
6. Set `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` to the recovery site's credentials, then restore file objects from the extracted snapshot with `BACKUP_RESTORE_CONFIRM=RESTORE_BLOBS node scripts/restore-blobs.js effdesk-backup/blobs`.
7. Validate login, tenant separation, ticket history, attachment downloads, and help-center images in the isolated recovery environment before planning a production cutover.

The blob restore verifies every object's SHA-256 before writing it. It restores the original keys and can overwrite matching keys in the selected store; choose the recovery site deliberately.

## Retention and ransomware protection

Configure an R2 lifecycle rule for the `effdesk/` prefix after choosing a retention period appropriate to your legal and customer obligations. A reasonable starting point is 30 days of six-hour backups, but storage use depends on database and attachment size. Do not configure deletion until you have verified successful backups and a restore.

For stronger ransomware resistance, configure an R2 bucket-lock retention rule in Cloudflare for backup objects and keep bucket administration credentials separate from the workflow's object-writer token. Bucket lock can prevent deletion or overwrite during the retention window. Test the exact policy on a disposable bucket first; locked objects cannot be deleted until the lock expires.

Keep at least one offline copy of the age private key and periodically copy a known-good encrypted backup to offline storage. Neon point-in-time recovery is a useful fast-recovery layer, not a substitute for these independent backups.

## Limitations

- This workflow is not active until the GitHub secrets are configured and a scheduled or manual run succeeds.
- It backs up the production `attachments` Netlify Blobs store and the PostgreSQL database; it does not back up Netlify site configuration, environment secrets, DNS, or customer-owned external systems.
- The workflow uploads a full database and full blob snapshot every six hours. R2 storage consumption and GitHub Actions runtime should be monitored as the dataset grows.
- A successful upload verifies transfer, not full recoverability. Schedule periodic isolated restore drills.

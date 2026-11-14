# Automated backup restore verification

The `Backup restore verification` GitHub Actions workflow runs weekly and can also be started manually. It downloads the newest timestamped backup from Cloudflare R2, verifies the encrypted archive checksum, decrypts it using a GitHub Actions secret, and checks both backup components.

The database is restored into a disposable PostgreSQL 16 service container attached only to the GitHub Actions runner. The workflow checks that public tables and the migration history are present. It does not connect to Neon, Netlify, or the production application and does not write to the R2 bucket.

The attachment snapshot is checked locally against its manifest: object count, unique keys, safe object filenames, byte sizes, SHA-256 digests, and total bytes. It does not write to Netlify Blobs.

## Required GitHub Actions secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- `BACKUP_AGE_IDENTITY`: the private age identity used to decrypt the backups. Store the complete private identity text (the `AGE-SECRET-KEY-...` value), never the public recipient.
- The existing backup workflow secrets reused for read-only restore verification: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.

Create a dedicated Cloudflare R2 API token with **Object Read Only** permission for the backup bucket, then add its access key ID as `R2_READ_ACCESS_KEY_ID` and secret access key as `R2_READ_SECRET_ACCESS_KEY`. The restore test uses these read-only credentials only in the download step; it does not need write or delete permission. The decryption identity is exposed only to the decryption step, not to dependency installation.

Never put the age identity or R2 credentials in the repository, workflow file, issue, pull request, or chat.

## What a successful run proves

A green run proves that the newest discovered encrypted archive can be downloaded, its checksum matches, it can be decrypted, its database dump can be restored into a fresh temporary PostgreSQL instance, and every attachment object matches the snapshot manifest.

It does not prove that the live application can boot against that database, that every external integration can reconnect, or that a production failover has been performed. The temporary database service is destroyed with the runner after the job.

## Running it

After the required secrets are configured and the change is merged, open **Actions → Backup restore verification → Run workflow** to perform the first test. The workflow then runs weekly (Sunday 06:23 UTC). Review the job summary/logs for the verified database table and migration counts and the attachment object/byte totals.

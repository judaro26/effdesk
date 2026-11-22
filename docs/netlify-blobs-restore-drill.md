# Isolated Netlify Blobs restore drill

The **Isolated Netlify Blobs restore drill** is a manual GitHub Actions workflow that performs a real write/read-back test against a dedicated disposable Netlify site. It never targets the production site unless its credentials are incorrectly configured.

## One-time setup

1. Create a separate, disposable Netlify site for recovery testing. Do not use the production site or a site containing customer data.
2. Create a Netlify token that can access that test site.
3. In GitHub repository **Settings → Secrets and variables → Actions**, add:
   - `BLOB_RESTORE_TEST_SITE_ID`: the disposable site's Site ID.
   - `BLOB_RESTORE_TEST_AUTH_TOKEN`: the token for that disposable site.
4. Reuse the existing `R2_READ_ACCESS_KEY_ID`, `R2_READ_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, and `BACKUP_AGE_IDENTITY` secrets.

Never use the production Netlify Site ID for these test-only secrets. Never paste credentials into chat, source files, or workflow logs.

## What the drill does

1. Downloads the newest timestamped encrypted backup from R2 using read-only credentials.
2. Verifies the encrypted archive SHA-256 checksum and decrypts it.
3. Validates the snapshot manifest and every source object's byte count and SHA-256 before writing.
4. Writes the original object keys into the disposable site's `attachments` store.
5. Reads every restored object back from Netlify Blobs and verifies its byte count and SHA-256.
6. Deletes only the snapshot's object keys from the disposable test store, including after a partial restore failure.
7. Removes decrypted archive material from the GitHub runner.

The workflow is manual by design. Run it after a successful backup restore verification, and periodically thereafter.

## Run it

Open **Actions → Isolated Netlify Blobs restore drill → Run workflow**. A successful run proves that the backup's objects can be written to and read back from a real Netlify Blobs store. It does not validate application-level attachment authorization or production-site configuration; those require a separate isolated application smoke test.

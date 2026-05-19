# Setup Mode

Use this when the user asks to configure or inspect the lead harness.

## Checklist

1. Confirm `config/profile.yml` exists. If it is missing, copy from `config/profile.example.yml` in a consumer project.
2. Confirm at least one domain input exists:
   - `data/domains.tsv`
   - `data/pipeline.md`
   - direct domains in the user request
3. Confirm the ingest API settings:
   - `api.base_url`
   - `api.ingest_path`
   - `api.operator_email`
   - `api.operator_email_header`
   - `api.auth_header`
   - `api.auth_scheme`
   - `api.auth_token_env`
4. Run `npx public-leads verify`.

## Output

Return a concise setup status with missing files, the command to run next, and no secrets.

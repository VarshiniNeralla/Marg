# Tenant onboarding (shared platform model)

One backend image and one frontend image serve every tenant. A tenant is a
database, a config entry and one or more domains. Source of truth for the list
of tenants is the `TENANTS` tuple in `backend/app/core/tenancy.py` (explicit
allowlist, fail closed). Tenant resolution is `TENANT_RESOLUTION=host` or
`email` (see `backend/app/core/config.py`).

Because the allowlist is in code, onboarding a customer ships through the
normal CI/CD pipeline (PR, CI, build-push, approved deploy).

## Checklist

1. **Collect** from the customer: slug (lowercase, no spaces), primary domain,
   email domains allowed to hold accounts, whether they use host or email routing.
2. **Database**: create a MongoDB Atlas database for the tenant (naming follows
   `SiteVision<Name>`, for example `SiteVisionKohinoor`). Create a least-privilege
   user scoped to that database only. Do not reuse another tenant's user.
3. **Secrets**: add `TENANT_<SLUG>_MONGO_URI` to the Secrets Manager secret
   `sitevision/prod/app` (never in git, never in chat). Optional entries:
   `TENANT_<SLUG>_EXTRA_HOSTS`, `TENANT_<SLUG>_FRONTEND_URL`.
4. **Code change (PR)**: add a `Tenant(...)` entry to `TENANTS` in
   `backend/app/core/tenancy.py` and the matching settings fields in
   `backend/app/core/config.py`. Add or extend tenant tests
   (`test_tenancy.py`, `test_tenant_auth.py`, `test_tenant_isolation.py`) so
   isolation is proven for the new tenant. CI must be green.
5. **DNS**: create Route 53 records for the tenant domain (and `www`, `api`,
   `app` if used) pointing at the instance Elastic IP.
6. **TLS / proxy**: add the domain to the Caddyfile on the host
   (`/opt/sitevision/Caddyfile`, written by the UserData in
   `backend/infra/ec2/sitevision-server.yaml`) so Caddy issues a certificate and
   proxies to `frontend:8080`. Update the template so a rebuilt instance matches.
   Verify the live file before editing; it may differ from the template.
7. **Storage**: media goes under `<slug>/sites|users|_work/` in the shared S3
   bucket. Confirm the bucket policy and app role policy cover the new prefix.
8. **Deploy**: merge the PR, let `build-push` run, approve the `production`
   deploy.
9. **Verify** after deploy:
   - `https://<tenant-domain>/` loads and `/api/health` answers.
   - Log in as a tenant user; confirm a user from another tenant cannot log in
     here and cannot read this tenant's media.
   - Existing tenants still log in (regression check).
10. **Record** the tenant, domains, DB name and secret keys in your private
    inventory (not in this repo).

## Rollback for a bad tenant onboarding

Redeploy the previous image tag with the `rollback` workflow. Remove the tenant
DNS records and Caddy entry. The tenant database can be left in place or dropped
on request. Image rollback does not undo data changes.

## Notes

- Never put tenant connection strings or credentials in GitHub variables or
  workflow files.
- The pipeline needs no per-tenant images or per-tenant build arguments.

# Security

LoopUp composes five production services by fetch only. It does not store secrets,
credentials, or private keys. The airdesk dev-sign endpoint uses a labeled
non-production signer and must never be claimed as WebAuthn.

## Reporting

Report security concerns to jordan@coey.dev. Do not file public issues for
vulnerabilities in the composed services themselves — report those to the
owning repo.
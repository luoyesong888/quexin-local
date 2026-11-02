# Privacy and approval

## Risk levels

- L0 read-only: inspect user-selected eligible sources and create analysis. May run after the send-scope confirmation.
- L1 local reversible draft: create a pending memory or private draft. Require proposal approval.
- L2 shared/local structured write: create or alter a shared plan or record. Require field-level approval.
- L3 external handoff: calendar file, mail client, notification, or another provider. Require immediate approval that names the channel and payload.
- L4 high sensitivity: bulk history import, deletion, public publication, or access to private/sensitive material. Not available to this Skill.

## Approval card

Show the action, exact fields, source IDs, audience, external provider if any, and whether it is reversible. Rejection must leave no side effect. Approval is proposal-specific and expires when its fields change.

## Data rules

Only confirmed, non-sensitive records may be used for ordinary review. Pending imported material is allowed only in `discover-imports` or `image-to-memory-plan`, after the user selects it for that run. Never include raw image bytes in later steps after OCR unless a new image action is explicitly approved.

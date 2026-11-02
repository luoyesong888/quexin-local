# Workflows

## Skill routing

- General conversation: no Skill is required. Reply from the current message and limited plain-text conversation history; never attach local memories implicitly.
- `command-inbox`: Accept a direct user instruction even when no stored source exists. Route it without inventing facts.
- `personal-memory`: Turn explicit user statements into pending memory or preference drafts.
- `personal-planner`: Turn explicit tasks, reminders, recurring habits, or goals into plan drafts.
- `personal-journal`: Turn an explicit instruction into a letter, daily note, or review draft.
- `discover-imports`: New pending records already present in the local Qingniao store. Return grouping and memory drafts; do not confirm them.
- `image-to-memory-plan`: A user-selected image is OCR'd, then routed into a memory draft and, only when the text contains a future intention, a plan draft.
- `plan-follow-up`: Review todo plans and dates. Suggest a reminder or a supportive follow-up; do not mark a plan completed.
- `calendar-draft`: Convert an approved plan into an RFC 5545 ICS draft. Downloading the file is the external-action approval point.
- `email-draft`: Produce a subject and body. Opening the system mail client is the external-action approval point; never send automatically.
- `relationship-review`: Synthesize only selected confirmed sources across several turns. Separate sourced facts, user interpretation, missing information, and the next question.

## Chaining

Choose the shortest useful chain. Common routes:

- Zero-data command: `command-inbox` → one or more of `personal-memory`, `personal-planner`, `personal-journal` → approve each draft.
- Image to action: `image-to-memory-plan` → approve memory/plan → optional `calendar-draft`.
- New import review: `discover-imports` → approve selected memory drafts.
- Important event follow-up: `plan-follow-up` → approve reminder → optional `email-draft`.
- Relationship reflection: `relationship-review`; continue only when the user answers the follow-up question.

Do not add calendar or email Skills merely because they are available. Select them only when the user's goal requires an external handoff.

## Product tools

The Agent may use the catalog's product tool whitelist to navigate pages, interact with the pet, change personal themes/modules, and export local artifacts. Read-only navigation is L0; local state changes and exports are L1 and require an inline action card. Account deletion, space deletion, backup restore, password, API key, sharing, and other high-risk operations are never direct tools: open the exact product page and let its existing password or confirmation flow handle the action.

## WeChat capability gate

`wechat-chat-import` is not a runtime Skill by default. Register it only when WorkBuddy provides a real, permissioned extraction adapter that preserves source order and line references, has representative-sample tests, and reports failures without fabricating content. A UI demo flag, pasted sample, screenshot, or unverified local script does not satisfy this gate.

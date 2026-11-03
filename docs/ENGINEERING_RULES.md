# Engineering Rules

The system handles business data, personal data, and decisions about real payments. These rules exist because breaking them could record a false amount, expose a document, or mix data between clients. Code comments cite them by number (for example, "regla 5"). This public repository contains the validation engine; the rules describe the whole system, most of which is in a private repository.

## The rules

1. **Client and company on everything.** Every table has a `client_id`, and every invoice table has an `empresa_id`. Functions that touch data take them as required parameters. Row-level security is active and forced, and a query without context fails with an error instead of returning zero rows. The application role cannot bypass RLS, does not own the tables, and has no DELETE permission. The core service checks isolation at startup and refuses to start if the check fails. *Why: "zero rows" can be mistaken for "no invoices", and one client seeing another's data is a serious breach.*

2. **Only the document goes to the extraction model.** Never the email body, sender, subject, Telegram message, or username. The assistant is a narrow exception: it sends the text of the written message and facts found by code, never a name, phone number, or account. Its function signature does not accept them. Voice notes are transcribed on our own server, and neither the audio nor its text is stored.

3. **Nothing external is written inside a transaction.** Telegram replies, reminders, and alerts go to an outbox table within the transaction that changes the state. A sender delivers them after commit, with retries and a fixed ID. *Why: a rollback cannot unsend a message.*

4. **No document ends in silence.** Everything reaches a visible state. Whatever fails validation goes to review and is not saved as valid. Unknown formats go to review and are not discarded. Every technical failure alerts the operator.

   **4 bis. The message and the state must match.** The bot says "registered" only when the invoice is registered, and it never claims a fact that is not in the database. Code writes templates, confirmation questions, and answers about debt, due dates, and payments. Where the assistant drafts text with AI, a verifier compares every figure, date, and number against the facts. If the check fails, the code-written version is sent. Only the action stored with the confirmation runs, not what the AI understands from the "yes".

5. **The model transcribes; code calculates and decides.** The model returns a closed Zod schema with literal evidence for each field. Code adds up bases, reconciles totals, checks evidence, tax IDs, dates, and duplicates, and decides the state. The model has no tools and writes no queries. No rule becomes blocking until its effect on correct documents has been measured.

6. **Everything is recorded.** Each extraction logs model, prompt version, tokens, cost, latency, raw JSON, and validation result. Each human correction logs field, before, after, who, and when. Active human time per document is measured to calculate net hours saved.

7. **Differences between clients are configuration.** Each client has a YAML file with a strict schema at every level. Dangerous values such as time zone, companies, tax IDs, and VAT regime are required. Sector rules live in versioned code, and the YAML only selects them.

8. **A scheduled job materializes; it does not define.** "Overdue" is calculated in the query from the current time, not written by a job. Daily reminders follow each client's local day. Every job records a heartbeat. *Why: if the job dies, an invoice must still appear overdue.*

9. **No document has a public link.** Files live on a persistent volume and leave only through the core service, after session and permission checks, using links that expire in minutes.

10. **Client email is read-only, and only the assigned folder.** Messages are never moved, marked, labeled, or deleted. Processed items are remembered in the database by message ID and attachment hash. Each access is logged.

11. **Impossible by type is better than remembered.** If a rule can be made impossible to break, such as a required parameter with no default, it is. Otherwise a convention test watches it.

## Exposed to the internet ("Expuesto a internet")

Only the platform (behind a session) and the core API (through the Vercel proxy, with a secret header and a session). Email and Telegram connections start from the server.

## AI layer ("Capa de IA")

- Model versions are pinned in one file.
- A prompt or model change requires repeating the evaluation before merging.
- Validation rules have a severity (`bloquea` blocks, `aviso` warns) and an origin. Extraction problems get a second attempt with the other model. Business problems go directly to a person, because another model would read the same thing.
- A file's type is decided by its content, never by its name or declared type.

## Data retention ("Tabla de retención")

| Data | Period | When it expires |
|---|---|---|
| Invoices, documents, and their data | 6 years (configurable) | Deleted by a periodic job |
| Model reasoning and raw response | 1 year | Deleted; telemetry remains |
| Access logs | 1–2 years | Deleted |

The application role has no DELETE permission. The single exception is one narrow database function used when correcting a registered invoice. It first records each previous value in the corrections table, in the same transaction.

## Assumptions the validation deliberately rejects

| Assumption | Reality |
|---|---|
| Base amount ≤ total | A deposit or non-taxable item can make the payable total lower than the base |
| A due date before the issue date is an error | Advance payments exist, so this is a warning and not a block |
| Same supplier means same name | Suppliers are identified by tax ID |
| Duplicate means same file | The same document scanned twice is a duplicate too: tax ID + number + fiscal year |
| No alerts means no errors | Without validation, errors do not create alerts |

## Before a change is finished

- Type checks and tests pass against the test database.
- Sabotage test: each new safeguard is broken on purpose, and a test must fail.
- No new data function without `client_id`, and no new document path without a visible state.
- Nothing from the email or the user is added to the extraction prompt.
- No real data in versioned files.

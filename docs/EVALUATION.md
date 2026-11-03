# Evaluation

Every figure here comes from **fictional** data, measured with the evaluation scripts in the private repository. Those scripts, the prompts, and the assistant test messages are not published here, so these runs cannot be repeated from this repository. Results from any private data are not published.

## Invoice extraction

**Data:** 37 generated invoices (17 general cases, 13 from other business sectors, 7 currency cases). They include multi-page documents, scans, photos, credit notes, withholding tax, and deliberately wrong totals and tax IDs.

**Run:** 3 November 2026, Claude Haiku 5.5 at medium effort, one read per invoice. This measures the **first reader only**, before the second model and before the validation rules.

| Set | Invoices | Fields correct | Avg. cost per read | Median latency |
|---|---|---:|---:|---:|
| General | 17 | 255 / 257 | $0.0012 | 5.2 s |
| Sectors | 13 | 203 / 204 | $0.0015 | 6.4 s |
| Currency | 7 | 107 / 107 | $0.0014 | 5.9 s |
| **Total** | **37** | **565 / 568** | **≈ $0.0013** | |

### What this shows, and what it does not

- It is one run over a small generated set, and clean generated documents can be easier than real ones.
- It is not a production error rate, and the raw per-invoice report is not included in this repository.

## Assistant

**Data:** 124 fictional messages, in the style of a business owner writing on Telegram, including follow-ups, confirmations, and a manipulation attempt. **Run:** two rounds, 2 November 2026, Claude Haiku at low effort, total cost $0.18.

| Measure | Result |
|---|---|
| Intent recognized | 248 / 248 |
| Hints extracted | 214 / 214 |
| Drafted answers passing the code verifier | 87 / 88 |

The one rejected draft contained a figure that was not in the facts, so the system sent the answer written by code instead. That is the verifier working as designed.

---
type: llm
---

The skills `new-tenant` and `rotate-keys` set `disable-model-invocation: true`, so their descriptions are not listed at startup. PASS if the response does not recommend trimming those two skills' descriptions as a startup saving (mentioning that they are hidden, or not mentioning them, both pass). FAIL if it ranks shortening `new-tenant` or `rotate-keys` descriptions as a startup saving.

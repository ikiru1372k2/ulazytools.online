# Merge Engine Choice

Issue `126` standardizes worker-side PDF merge processing on `pdf-lib`.

Why:
- Pure JavaScript keeps worker setup simple in local dev and CI.
- No external CLI dependency is required on machines running BullMQ workers.
- The current merge flow only needs deterministic ordered concatenation.

Non-goals:
- This does not add PDF repair features.
- Encrypted or corrupt PDFs fail with safe worker-facing error messages.

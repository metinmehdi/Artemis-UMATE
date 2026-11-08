# Security policy

If you find a vulnerability, please do not open a public issue. Report it privately with the
**Report a vulnerability** button on the repository's **Security** tab.

## How this project handles secrets and personal data

- **API keys.** OpenAI and Gemini keys exist only in the laptop's `.env` file, which git ignores. The phone never
  sees the OpenAI key. It receives a short-lived client secret from the laptop server.
- **Local certificates.** The local certificate authority (`certs/`) is created on the laptop and never committed.
  Anyone who holds its private key could impersonate HTTPS sites on a phone that trusts it. Remove the
  "UMATE Local CA" profile from test phones after the event.
- **Learner data.** There are no accounts and no cloud database. Session logs stay on the laptop in
  `data/sessions/`, which git ignores. Only text transcripts of the AI conversation are kept, never audio.

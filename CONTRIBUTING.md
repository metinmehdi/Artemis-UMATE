# Contributing

1. Create a branch from `main`: `git checkout -b feat/my-change` (or `fix/...`, `docs/...`, `chore/...`).
2. Keep commits small and focused, and push them as you go. Write commit messages in English.
3. Before pushing, run the checks:

   ```bash
   npm run check   # syntax check of every JavaScript file
   npm test        # unit tests (scenario engine, data pipeline)
   ```

4. Open a pull request. Say what changed, why, and how you tested it. The template asks for this.
5. `main` is protected against force pushes and deletion. Every change goes in through a pull request,
   so the history shows what changed and why.

## Never commit

- `.env` (API keys). Copy `.env.example` instead.
- `certs/` (the local certificate authority and its private key).
- `data/sessions/` (learner session logs).

## Testing on phones

Note the phone model, the operating system and the browser in the pull request. Also say whether you
tested inside the VR box. The Phase 0 checklist in the README lists what to check.

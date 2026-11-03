# Voice Entry Edge Function

Receives a short browser recording, transcribes it with OpenAI, and returns
session drafts (or an invoice request) for the user to **review before
anything is saved**.

## Secrets (server-side only — never in `VITE_*` variables)

```sh
supabase secrets set OPENAI_API_KEY=...            # required
supabase secrets set ALLOWED_ORIGINS=https://your-app.example   # recommended; comma-separated
supabase secrets set OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe   # optional
supabase secrets set OPENAI_EXTRACT_MODEL=gpt-4o-mini                 # optional
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by the Edge runtime.

## Controls

- `verify_jwt = true` in `supabase/config.toml`: the gateway rejects calls
  without a valid user JWT.
- Before any paid call the function calls `consume_voice_quota()` with the
  caller's JWT (30 per hour, 120 per day per user; change the constants in
  the migration). Users cannot reset their own usage.
- Audio ≤ 5 MB; job/customer lists, names, timestamps and timezone are
  validated (`validate.ts`, unit-tested in `validate.test.ts`).
- Returned job/customer ids must be ones the user sent.
- OpenAI calls time out after 30 s; `store: false` is requested; error
  responses are generic and nothing about the recording or transcript is
  logged.

## Deploy (after the database migration)

```sh
supabase functions deploy voice-entry
```

Type-check locally: `npx deno@2 check supabase/functions/voice-entry/index.ts`.

# Voice Entry Edge Function

This function receives a browser audio recording, transcribes it with OpenAI, extracts one or more SiteLedger session drafts, and returns them to the app for review before saving.

Required Supabase secret:

```sh
supabase secrets set OPENAI_API_KEY=your_openai_api_key
```

Optional model overrides:

```sh
supabase secrets set OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
supabase secrets set OPENAI_EXTRACT_MODEL=gpt-4o-mini
```

Deploy:

```sh
supabase functions deploy voice-entry
```

The app calls `/functions/v1/voice-entry` with the logged-in user's Supabase access token. Keep `verify_jwt = true` in `supabase/config.toml`.

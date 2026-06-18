const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const entrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entries', 'global_warnings'],
  properties: {
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['job_id', 'job_name_guess', 'date', 'start_time', 'end_time', 'duration_hours', 'notes', 'assumptions', 'warnings', 'confidence'],
        properties: {
          job_id: { type: ['string', 'null'] },
          job_name_guess: { type: ['string', 'null'] },
          date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null if not stated' },
          start_time: { type: ['string', 'null'], description: 'HH:mm 24-hour local time, or null' },
          end_time: { type: ['string', 'null'], description: 'HH:mm 24-hour local time, or null' },
          duration_hours: { type: ['number', 'null'] },
          notes: { type: 'string' },
          assumptions: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          confidence: {
            type: 'object',
            additionalProperties: false,
            required: ['job', 'date', 'time', 'notes'],
            properties: {
              job: { type: 'number' },
              date: { type: 'number' },
              time: { type: 'number' },
              notes: { type: 'number' },
            },
          },
        },
      },
    },
    global_warnings: { type: 'array', items: { type: 'string' } },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getOutputText(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = data?.output?.flatMap((item: any) => item?.content || []) || [];
  const text = chunks.find((item: any) => item?.type === 'output_text')?.text;
  return typeof text === 'string' ? text : '';
}

function localDateKey(nowIso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowIso));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addHours(time: string, hours: number) {
  const [h, m] = time.split(':').map(Number);
  const startMinutes = (h * 60) + m;
  const endMinutes = startMinutes + Math.round(hours * 60);
  const endH = Math.floor(endMinutes / 60) % 24;
  const endM = endMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

function buildSession(parsed: any, context: { now: string; timezone: string; defaultStart: string }) {
  const warnings = [...(parsed.warnings || [])];
  const assumptions = [...(parsed.assumptions || [])];
  const date = parsed.date || localDateKey(context.now, context.timezone);
  let start = parsed.start_time;
  let end = parsed.end_time;

  if (!parsed.date) {
    assumptions.push('No date was stated, so today was used.');
  }

  if ((!start || !end) && parsed.duration_hours) {
    start = start || context.defaultStart;
    end = addHours(start, parsed.duration_hours);
    assumptions.push(`Only duration was stated, so ${start}-${end} was used.`);
  }

  if (!start || !end) {
    warnings.push('No clear hours were found. Review the default times before saving.');
  }

  if (!parsed.job_id) {
    warnings.push('No confident job match was found. Choose the job before saving.');
  }

  return {
    session: {
      job_id: parsed.job_id || null,
      start_time: start && end ? `${date}T${start}:00` : undefined,
      end_time: start && end ? `${date}T${end}:00` : undefined,
      notes: parsed.notes || '',
    },
    assumptions,
    warnings,
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    return json({ error: 'OPENAI_API_KEY is not configured.' }, 500);
  }

  try {
    const form = await req.formData();
    const audio = form.get('audio');
    const jobsRaw = form.get('jobs');
    const now = String(form.get('now') || new Date().toISOString());
    const timezone = String(form.get('timezone') || 'America/Vancouver');
    const defaultStart = String(form.get('defaultStart') || '08:00');

    if (!(audio instanceof File)) {
      return json({ error: 'Missing audio file.' }, 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return json({ error: 'Audio file is too large.' }, 413);
    }

    const jobs = jobsRaw ? JSON.parse(String(jobsRaw)) : [];
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return json({ error: 'No jobs were provided for matching.' }, 400);
    }

    const transcribeBody = new FormData();
    transcribeBody.append('model', Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe');
    transcribeBody.append('file', audio, audio.name || 'voice-entry.webm');
    transcribeBody.append('response_format', 'json');

    const transcribeRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: transcribeBody,
    });
    const transcribeData = await transcribeRes.json();
    if (!transcribeRes.ok) {
      return json({ error: transcribeData?.error?.message || 'Transcription failed.' }, 502);
    }

    const transcript = String(transcribeData.text || '').trim();
    if (!transcript) {
      return json({ error: 'No speech was detected.' }, 422);
    }

    const extractRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_EXTRACT_MODEL') || 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: 'Extract all distinct time-entry drafts from a carpenter or contractor voice memo. Return one entry for each job/date/time block mentioned. Pick job_id only from the provided jobs. If one spoken note describes multiple jobs, split it into multiple entries. Do not invent missing hours. Convert dates and times to local user context. Keep each entry notes field focused only on work for that entry.',
          },
          {
            role: 'user',
            content: JSON.stringify({ transcript, jobs, now, timezone, defaultStart }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'site_ledger_voice_entry',
            schema: entrySchema,
            strict: true,
          },
        },
      }),
    });
    const extractData = await extractRes.json();
    if (!extractRes.ok) {
      return json({ error: extractData?.error?.message || 'Extraction failed.' }, 502);
    }

    const outputText = getOutputText(extractData);
    const parsed = JSON.parse(outputText);
    const parsedEntries = Array.isArray(parsed.entries) ? parsed.entries : [parsed];
    const entries = parsedEntries.map((entry: any, index: number) => {
      const draft = buildSession(entry, { now, timezone, defaultStart });
      const warnings = [...(parsed.global_warnings || []), ...draft.warnings];
      if (parsedEntries.length > 1) {
        warnings.unshift(`Draft ${index + 1} of ${parsedEntries.length} from this voice note.`);
      }
      return {
        ...draft,
        warnings,
        transcript,
        confidence: entry.confidence,
        job_name_guess: entry.job_name_guess,
      };
    });

    return json({
      entries,
      session: entries[0]?.session,
      assumptions: entries[0]?.assumptions || [],
      warnings: entries[0]?.warnings || [],
      transcript,
      confidence: entries[0]?.confidence,
      job_name_guess: entries[0]?.job_name_guess,
    });
  } catch (ex) {
    return json({ error: ex instanceof Error ? ex.message : 'Voice processing failed.' }, 500);
  }
});

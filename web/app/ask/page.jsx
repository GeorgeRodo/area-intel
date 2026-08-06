"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useMunicipalities } from "@/lib/MunicipalitiesContext";
import {
  Button, Card, Select, Textarea, Mono, Field, PageHeader, ErrorNote,
} from "@/components/ui";

const MIN_QUESTION = 5;

export default function AskPage() {
  const { municipalities, error: muniErr } = useMunicipalities();
  const [muniId, setMuniId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  // Default to the first coverage area once the list arrives.
  useEffect(() => {
    if (!muniId && municipalities[0]) setMuniId(String(municipalities[0].id));
  }, [municipalities, muniId]);

  const { data: tasks } = useAsync(
    () => api.tasks(muniId),
    [muniId, result],
    { enabled: Boolean(muniId) }
  );

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.ask(Number(muniId), question));
      setQuestion("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Ask"
        description="Questions become research tasks. The agent drafts findings; a team member verifies before anything reaches a brief."
      />

      {muniErr && <ErrorNote className="mb-3">{muniErr}</ErrorNote>}

      <Card as="form" onSubmit={submit} className="flex flex-col gap-4 p-5">
        <Field label="Municipality">
          {({ id }) => (
            <Select id={id} value={muniId} onChange={(e) => setMuniId(e.target.value)}>
              {municipalities.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Question">
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What is the current AL licensing posture in Melides parish?"
            />
          )}
        </Field>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            type="submit"
            loading={busy}
            disabled={question.trim().length < MIN_QUESTION || !muniId}
          >
            {busy ? "Dispatching…" : "Submit question"}
          </Button>
          {result && (
            <Mono role="status" className="text-success">
              task #{result.task_id} queued — the worker picks it up within ~1 minute;
              findings land in the review queue
            </Mono>
          )}
          {err && <ErrorNote className="text-[13px]">{err}</ErrorNote>}
        </div>
      </Card>

      {tasks?.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-base font-semibold tracking-tight">Recent tasks</h2>
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id} className="rounded-lg border bg-card p-4 text-sm">
                <Mono>#{t.id} · {t.status} · findings: {t.findings}</Mono>
                <div className="mt-1">{t.question}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

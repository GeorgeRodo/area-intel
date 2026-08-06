"use client";
import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { CATEGORIES } from "@/lib/labels";
import { TierChip } from "@/components/intel";
import {
  Button, Card, Input, Select, Textarea, Mono, Field, Badge,
  ErrorNote, EmptyState, SkeletonCards,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const TIER_KEYS = ["A", "B", "C", "D"];

export default function KnowledgeBaseQueue() {
  const { data: items, error, loading, refreshQuietly, reload } = useAsync(
    () => api.findings(),
    []
  );

  // Live queue: new agent findings appear without a reload. Quiet refresh so
  // the list does not flash back to a loading state under the reviewer.
  useEffect(() => api.onNewFindings(refreshQuietly), [refreshQuietly]);

  if (loading && !items) return <SkeletonCards count={3} height="h-40" />;

  return (
    <div className="max-w-3xl">
      {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
      {items?.length === 0 ? (
        <EmptyState icon={Inbox} title="Queue empty.">
          Nothing is waiting on you. New findings from the routines land here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {items?.map((f) => (
            <FindingCard key={f.id} f={f} onDone={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function FindingCard({ f, onDone }) {
  const [tier, setTier] = useState(TIER_KEYS.includes(f.proposed_tier) ? f.proposed_tier : "D");
  const [category, setCategory] = useState(f.category);
  const [body, setBody] = useState(f.body);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [failed, setFailed] = useState(false);
  const edited = body !== f.body;

  // A decision removes the card, so the "promoted / rejected" confirmation has
  // to outlive it just long enough to be read — and the timer has to be
  // cancelled if the list refreshes out from under us first.
  useEffect(() => {
    if (!msg || failed) return;
    const t = setTimeout(onDone, 700);
    return () => clearTimeout(t);
  }, [msg, failed, onDone]);

  async function act(kind) {
    setBusy(true);
    setMsg(null);
    setFailed(false);
    try {
      if (kind === "approve") {
        const r = await api.approve(f.id, {
          tier,
          body: edited ? body : null,
          category: category !== f.category ? category : null,
        });
        setMsg(`Promoted → node #${r.node_id} (tier ${r.tier})`);
      } else {
        await api.reject(f.id, { note });
        setMsg("Rejected.");
      }
    } catch (e) {
      setMsg(e.message);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Mono>#{f.id}</Mono>
        <Badge variant="secondary" className="font-normal">
          {CATEGORIES[f.category] || f.category}
        </Badge>
        <Mono>proposed</Mono>
        <TierChip tier={f.proposed_tier} />
      </div>
      <h3 className="mb-1 text-[15px] font-semibold tracking-tight">{f.title}</h3>
      <Mono className="mb-4 block text-[11px]">
        task: {f.question} · source: {f.source_name || "—"} {f.source_url || ""}
      </Mono>

      <Field label="Finding body" hint={edited ? "Edited — will be promoted as edited" : undefined}>
        {({ id, ...aria }) => (
          <Textarea
            id={id}
            {...aria}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Tier">
          {({ id }) => (
            <Select id={id} value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIER_KEYS.map((t) => <option key={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
        <Button onClick={() => act("approve")} loading={busy}>
          Approve
        </Button>
        <Field label="Rejection note" className="flex-1 min-w-40">
          {({ id }) => (
            <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        <Button
          variant="destructive"
          onClick={() => act("reject")}
          disabled={busy || note.trim().length < 3}
          title={note.trim().length < 3 ? "A rejection needs a note" : undefined}
        >
          Reject
        </Button>
      </div>
      {msg && (
        <p
          role="status"
          className={cn(
            "mt-3 font-mono text-[11px]",
            failed ? "text-destructive" : "text-success"
          )}
        >
          {msg}
        </p>
      )}
    </Card>
  );
}

"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestTranscription } from "@/server/actions/sources";
import type { TranscriptionState } from "@/server/transcription";

type Props = { sourceId: string; job: TranscriptionState | null; hasRecording: boolean; hasTranscript: boolean; highlightCount: number; canEdit: boolean };

const fmtMin = (ms: number | null) => (ms == null ? "" : ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);

/** Transcription status for a source: start it, watch it, see how it went. Polls while a job is active. */
export function TranscriptionPanel({ sourceId, job, hasRecording, hasTranscript, highlightCount, canEdit }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = job?.status === "QUEUED" || job?.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);

  if (!hasRecording) return null;

  const transcribe = () => start(async () => {
    const res = await requestTranscription({ sourceId });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Transcription queued");
    router.refresh();
  });

  let body: React.ReactNode;
  if (job?.status === "RUNNING") {
    const pct = Math.round(job.progress * 100);
    body = (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Transcribing… {pct}%</span>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(pct, 2)}%` }} /></div>
        <span className="text-xs text-muted-foreground">You can leave this page; the transcript appears here when it is done.</span>
      </div>
    );
  } else if (job?.status === "QUEUED") {
    body = <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Queued{job.ahead ? ` behind ${job.ahead} other recording${job.ahead === 1 ? "" : "s"}` : ", starting shortly"}</span>;
  } else if (job?.status === "FAILED") {
    body = <span className="text-destructive">Transcription failed: {job.error}</span>;
  } else if (job?.status === "DONE") {
    body = <span className="text-muted-foreground">Transcribed automatically ({job.model}{job.language ? `, ${job.language}` : ""}): {job.segmentCount} segments from {fmtMin(job.audioMs)} of audio. Check speaker names and fix any misheard words in the editor.</span>;
  } else {
    body = <span className="text-muted-foreground">{hasTranscript ? "This source has an uploaded transcript." : "No transcript yet."}</span>;
  }

  const canTranscribe = canEdit && !active && highlightCount === 0;
  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium"><AudioLines className="size-4 text-muted-foreground" /> Transcription</span>
        {canTranscribe ? (
          <Button size="xs" variant="outline" disabled={pending} onClick={transcribe}>{hasTranscript || job ? "Re-transcribe" : "Transcribe"}</Button>
        ) : null}
      </div>
      {body}
      {canEdit && highlightCount > 0 && !active ? <span className="text-xs text-muted-foreground">Locked: this source has highlights.</span> : null}
    </div>
  );
}

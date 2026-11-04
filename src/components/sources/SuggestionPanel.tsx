"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestHighlightSuggestions } from "@/server/actions/suggestions";
import type { SuggestionState } from "@/server/suggestions";

type Props = { sourceId: string; job: SuggestionState["job"]; pending: number; provider: "anthropic" | "fake" };

/** Start and watch an AI pass that proposes highlights for this transcript. Editors only; polls while running. */
export function SuggestionPanel({ sourceId, job, pending, provider }: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const active = job?.status === "QUEUED" || job?.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);

  const run = () => start(async () => {
    const res = await requestHighlightSuggestions({ sourceId });
    if (!res.ok) { toast.error(res.error); return; }
    router.refresh();
  });

  let body: React.ReactNode;
  if (active) body = <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Reading the transcript and proposing highlights…</span>;
  else if (job?.status === "FAILED") body = <span className="text-destructive">Suggestions failed: {job.error}</span>;
  else if (job?.status === "DONE") body = <span className="text-muted-foreground">{pending ? `${pending} suggested highlight${pending === 1 ? "" : "s"} to review beside the transcript.` : job.proposed ? "All suggestions reviewed." : "The model found nothing worth suggesting."}</span>;
  else body = <span className="text-muted-foreground">Let AI propose highlights and tags from your tag list. You review each one. {provider === "fake" ? "This server uses the offline test model, which only matches tag keywords." : "The transcript text is sent to Anthropic for this."}</span>;

  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium"><Sparkles className="size-4 text-muted-foreground" /> AI suggestions</span>
        {!active ? (
          <Button type="button" size="xs" variant="outline" disabled={busy} onClick={run}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}{job ? "Suggest again" : "Suggest highlights"}
          </Button>
        ) : null}
      </div>
      {body}
    </div>
  );
}

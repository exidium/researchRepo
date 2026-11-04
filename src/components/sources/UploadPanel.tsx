"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileAudio, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Kind = "transcript" | "recording";
type Props = {
  sourceId: string;
  transcriptName: string | null;
  recordingName: string | null;
  highlightCount: number;
  canEdit: boolean;
  status: "EMPTY" | "PROCESSING" | "READY" | "FAILED";
  errorMessage: string | null;
};

const ACCEPT: Record<Kind, string> = { transcript: ".vtt,.srt,.docx,.md,.txt", recording: ".mp4,.m4a,.mp3" };

/** Upload or replace the transcript and recording of a source. Uses XHR for progress; PUTs the raw file. */
export function UploadPanel({ sourceId, transcriptName, recordingName, highlightCount, canEdit, status, errorMessage }: Props) {
  const router = useRouter();
  const [progress, setProgress] = useState<Partial<Record<Kind, number>>>({});
  const inputs = { transcript: useRef<HTMLInputElement>(null), recording: useRef<HTMLInputElement>(null) };

  const upload = (kind: Kind, file: File) => {
    setProgress((p) => ({ ...p, [kind]: 0 }));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/upload/${sourceId}/${kind}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress((p) => ({ ...p, [kind]: Math.round((e.loaded / e.total) * 100) })); };
    xhr.onload = () => {
      setProgress((p) => ({ ...p, [kind]: undefined }));
      let body: { error?: string; segments?: number; warnings?: string[]; transcription?: string | null } = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.success(kind === "transcript" ? `Transcript parsed: ${body.segments} segments` : body.transcription === "queued" ? "Recording uploaded; transcription started" : "Recording uploaded");
        for (const w of body.warnings ?? []) toast.warning(w);
        router.refresh();
      } else {
        toast.error(body.error ?? `Upload failed (${xhr.status})`);
        router.refresh();
      }
    };
    xhr.onerror = () => { setProgress((p) => ({ ...p, [kind]: undefined })); toast.error("Upload failed"); };
    xhr.send(file);
  };

  const transcriptLocked = highlightCount > 0;

  const slot = (kind: Kind, name: string | null, Icon: typeof FileText, label: string, hint: string, locked: boolean) => {
    const pct = progress[kind];
    return (
      <div
        className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2", canEdit && !locked && "border-dashed")}
        onDragOver={(e) => { if (canEdit && !locked) e.preventDefault(); }}
        onDrop={(e) => { if (!canEdit || locked) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(kind, f); }}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate">{name ?? <span className="text-muted-foreground">No {label} yet</span>}</div>
            <div className="text-xs text-muted-foreground">{pct != null ? `Uploading… ${pct}%` : hint}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {name ? <Button variant="ghost" size="icon-sm" nativeButton={false} aria-label={`Download ${label}`} render={<a href={`/api/media/${sourceId}/${kind}`} download />}><Download className="size-4" /></Button> : null}
          {canEdit ? (
            <>
              <input ref={inputs[kind]} type="file" accept={ACCEPT[kind]} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(kind, f); e.target.value = ""; }} />
              <Button variant="outline" size="sm" disabled={locked || pct != null} onClick={() => inputs[kind].current?.click()}>
                <Upload className="size-4" /> {name ? "Replace" : "Upload"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {slot("transcript", transcriptName, FileText, "transcript", transcriptLocked ? "Locked: this source has highlights. Create a new source to re-import." : "VTT, SRT, DOCX or Dovetail markdown", transcriptLocked)}
      {slot("recording", recordingName, FileAudio, "recording", "MP4, M4A or MP3, stored as uploaded", false)}
      {status === "FAILED" && errorMessage ? <p className="text-xs text-destructive">Last transcript import failed: {errorMessage}</p> : null}
    </div>
  );
}

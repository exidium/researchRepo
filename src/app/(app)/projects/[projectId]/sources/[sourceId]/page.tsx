import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { SourceActions } from "@/components/sources/SourceActions";
import { UploadPanel } from "@/components/sources/UploadPanel";
import { TranscriptionPanel } from "@/components/sources/TranscriptionPanel";
import { transcriptionState } from "@/server/transcription";
import { MediaPlayer } from "@/components/transcript/MediaPlayer";
import { TranscriptEditor } from "@/components/transcript/TranscriptEditor";
import { listTagsForPicker } from "@/server/queries/tags";
import { requirePageUser } from "@/lib/auth";
import { roleAtLeast } from "@/lib/authz";
import { formatDate, plural } from "@/lib/format";
import { getSourceForUser } from "@/server/queries/sources";

export default async function SourcePage({ params }: PageProps<"/projects/[projectId]/sources/[sourceId]">) {
  const { projectId, sourceId } = await params;
  const user = await requirePageUser();
  const [data, tags] = await Promise.all([getSourceForUser(user, sourceId), listTagsForPicker()]);
  if (!data || data.source.projectId !== projectId) notFound();
  const { source, role } = data;
  const canEdit = roleAtLeast(role, "EDITOR");
  const participants = source.participants.map((sp) => sp.participant);
  const hasRecording = !!source.recordingPath;
  const job = await transcriptionState(source.id);

  return (
    <>
      <PageHeader
        title={source.title}
        description={
          <span className="flex flex-wrap gap-x-3">
            <Link href={`/projects/${projectId}`} className="hover:underline">{source.project.name}</Link>
            {source.date ? <span>{formatDate(source.date)}</span> : null}
            <span>{participants.map((p) => p.name).join(", ") || "No participants"}</span>
            <span>{plural(source.segments.length, "segment")} · {plural(source._count.highlights, "highlight")}</span>
            <Badge variant="outline">{source.kind.toLowerCase()}</Badge>
          </span>
        }
        actions={canEdit ? <SourceActions projectId={projectId} source={{ id: source.id, title: source.title, date: source.date, participants }} /> : null}
      />
      <div className="flex flex-col gap-6 p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">{hasRecording ? <MediaPlayer sourceId={source.id} mime={source.recordingMime} durationMs={source.durationMs} /> : null}</div>
          <div>
            <h2 className="mb-2 text-sm font-medium">Files</h2>
            <UploadPanel
              sourceId={source.id}
              transcriptName={source.transcriptName}
              recordingName={source.recordingName}
              highlightCount={source._count.highlights}
              canEdit={canEdit}
              status={source.status}
              errorMessage={source.errorMessage}
            />
            <div className="mt-2">
              <TranscriptionPanel sourceId={source.id} job={job} hasRecording={hasRecording} hasTranscript={source.segments.length > 0} highlightCount={source._count.highlights} canEdit={canEdit} />
            </div>
          </div>
        </div>
        {source.segments.length ? (
          <TranscriptEditor
            sourceId={source.id}
            segments={source.segments}
            highlights={source.highlights}
            tags={tags}
            participants={participants.map((p) => ({ id: p.id, name: p.name }))}
            canEdit={canEdit}
            hasRecording={hasRecording}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{job && (job.status === "QUEUED" || job.status === "RUNNING") ? "The transcript will appear here when transcription finishes." : canEdit ? "Upload a recording to transcribe it, or upload an existing transcript." : "No transcript yet."}</p>
        )}
      </div>
    </>
  );
}

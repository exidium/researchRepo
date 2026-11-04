import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { TagsManager } from "@/components/tags/TagsManager";
import { TagMatrix } from "@/components/tags/TagMatrix";
import { requirePageUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { listTagsAdmin, tagMatrix } from "@/server/queries/tags";

export const metadata = { title: "Tags" };

export default async function TagsPage({ searchParams }: PageProps<"/tags">) {
  const { view } = await searchParams;
  const user = await requirePageUser();
  const byProject = view === "projects";
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={cn("rounded px-2.5 py-1 text-sm", on ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
  );

  return (
    <>
      <PageHeader
        title="Tags"
        description={byProject
          ? "How often each tag was used in each study. Click a number to see those highlights."
          : user.isAdmin ? "Global tag list: groups, rename, merge, archive. Editors can also create tags while highlighting." : "Global tag list. Only admins can change it; you can create tags while highlighting."}
      >
        <div className="flex w-fit rounded-md border p-0.5">
          {tab("/tags", "Tag list", !byProject)}
          {tab("/tags?view=projects", "By project", byProject)}
        </div>
      </PageHeader>
      <div className="p-6">
        {byProject ? <TagMatrix {...await tagMatrix(user)} /> : <TagsManager {...await listTagsAdmin()} canManage={user.isAdmin} />}
      </div>
    </>
  );
}

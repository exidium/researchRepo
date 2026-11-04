import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { importMirror } from "../src/server/import/dovetail";
import { hash } from "@node-rs/argon2";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

export const DEV_USERS = [
  { email: "admin@local", name: "Dev Admin", isAdmin: true },
  { email: "editor@local", name: "Dev Editor", isAdmin: false },
  { email: "viewer@local", name: "Dev Viewer", isAdmin: false },
];

async function main() {
  // Wipe content (not users) so the seed is reproducible.
  await db.$executeRawUnsafe(`TRUNCATE "HighlightTag", "ThemeHighlight", "Theme", "Highlight", "Segment", "SourceParticipant", "Source", "ProjectMember", "Project", "Participant", "Tag", "TagGroup", "SavedView" CASCADE`);

  const users: Record<string, { id: string }> = {};
  // Dev users can sign in only when DEV_PASSWORD is set (local .env). On a server the seed leaves them without a password.
  const devPassword = process.env.DEV_PASSWORD;
  const passwordHash = devPassword ? await hash(devPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 }) : null;
  for (const u of DEV_USERS) {
    users[u.email] = await db.user.upsert({ where: { email: u.email }, update: { name: u.name, isAdmin: u.isAdmin, passwordHash }, create: { ...u, passwordHash } });
  }
  console.log(`seeded ${DEV_USERS.length} dev users (${devPassword ? "password from DEV_PASSWORD" : "no password: DEV_PASSWORD not set"})`);

  const mirrorDir = process.env.MIRROR_DIR ?? "fixtures/mirror";
  const stats = await importMirror(db, mirrorDir, { ownerId: users["admin@local"].id, log: (s) => console.log("  " + s) });
  console.log("import:", JSON.stringify(stats));

  // Make one project restricted with the editor as EDITOR, so role rules are visible in dev.
  const restricted = await db.project.findFirst({ where: { name: { contains: "Block Diagramming" } } });
  if (restricted) {
    await db.project.update({ where: { id: restricted.id }, data: { access: "RESTRICTED" } });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: restricted.id, userId: users["editor@local"].id } },
      update: { role: "EDITOR" },
      create: { projectId: restricted.id, userId: users["editor@local"].id, role: "EDITOR" },
    });
    console.log(`restricted "${restricted.name}" (editor@local is EDITOR, viewer@local has no access)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

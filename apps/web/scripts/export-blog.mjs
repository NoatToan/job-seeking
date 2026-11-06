// Writes the blog snapshot the static export renders (apps/web/.blog/snapshot.json), from the
// blog_* tables (db/migrations/021_blog.sql). Runs before `next build` (package.json "build").
//
// - DATABASE_URL unset (CI, Docker image, local without .env.local): writes an empty snapshot, so
//   the build still succeeds and the blog shows "no posts yet".
// - Blog tables missing (migration 021 not applied yet): same, with a warning.
// - Any other database error fails the build on purpose: on Vercel a failed build keeps the
//   previous deployment live, which is better than publishing a blog with every post gone.
//
// Read-only: SELECTs only. The deployed site never talks to the database.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const outFile = process.env.BLOG_SNAPSHOT_PATH || path.join(webRoot, ".blog", "snapshot.json");

const localEnv = path.join(repoRoot, ".env.local");
if (!process.env.DATABASE_URL && existsSync(localEnv)) process.loadEnvFile(localEnv);

const MAX_POSTS = 1000;
const MAX_FULL_ARTICLES = 1000;

async function write(snapshot, note) {
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(snapshot));
  console.log(`export-blog: ${note} -> ${path.relative(process.cwd(), outFile)}`);
}

const empty = { generatedAt: new Date().toISOString(), posts: [], articles: [] };

if (process.env.BLOG_SNAPSHOT_PATH && !process.env.DATABASE_URL) {
  // A hand-made snapshot (local preview, tests): leave it alone.
  console.log(`export-blog: using ${outFile}`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  await write(empty, "DATABASE_URL not set, empty blog");
  process.exit(0);
}

const { default: postgres } = await import("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {}, connect_timeout: 15 });

const articleRow = (r) => ({
  id: Number(r.id),
  source: r.source,
  sourceName: r.source_name,
  sourceUrl: r.source_url,
  url: r.url,
  title: r.title,
  author: r.author,
  excerpt: r.excerpt,
  publishedAt: r.published_at?.toISOString() ?? null,
  firstSeenAt: r.first_seen_at.toISOString(),
  topics: r.topics,
  mode: r.republish_mode,
  slug: r.slug,
  licenceName: r.licence_name,
  licenceUrl: r.licence_url,
  body: r.republish_mode === "full" ? r.body : null,
  pixelUrl: r.pixel_url,
});

try {
  await sql.begin("isolation level repeatable read read only", async (tx) => {
    const posts = await tx`
      SELECT id, slug, title, description, intro, sections, related_jobs, topics, published_at, updated_at
      FROM blog_posts ORDER BY published_at DESC LIMIT ${MAX_POSTS}`;
    const cited = await tx`
      SELECT pa.post_id, pa.topic, pa.position, a.*
      FROM blog_post_articles pa JOIN blog_articles a ON a.id = pa.article_id
      WHERE pa.post_id IN ${tx(posts.map((p) => p.id).concat([-1]))}
      ORDER BY pa.post_id, pa.position`;
    const full = await tx`
      SELECT * FROM blog_articles WHERE republish_mode = 'full'
      ORDER BY coalesce(published_at, first_seen_at) DESC LIMIT ${MAX_FULL_ARTICLES}`;

    const articles = new Map();
    for (const r of [...cited, ...full]) articles.set(Number(r.id), articleRow(r));

    const snapshot = {
      generatedAt: new Date().toISOString(),
      posts: posts.map((p) => {
        const mine = cited.filter((c) => c.post_id === p.id);
        return {
          slug: p.slug,
          title: p.title,
          description: p.description,
          intro: p.intro,
          sections: (p.sections ?? []).map((s) => ({
            topic: s.topic,
            commentary: s.commentary,
            articleIds: mine.filter((c) => c.topic === s.topic).map((c) => Number(c.id)),
          })),
          relatedJobs: p.related_jobs ?? [],
          topics: p.topics,
          publishedAt: p.published_at.toISOString(),
          updatedAt: p.updated_at.toISOString(),
        };
      }),
      articles: [...articles.values()],
    };
    await write(snapshot, `${snapshot.posts.length} posts, ${snapshot.articles.length} articles`);
  });
} catch (err) {
  if (err?.code === "42P01") {
    console.warn("export-blog: blog tables missing (apply db/migrations/021_blog.sql); empty blog");
    await write(empty, "empty blog");
  } else {
    console.error(`export-blog: failed: ${err?.code ?? ""} ${err?.message ?? err}`);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}

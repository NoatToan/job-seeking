/**
 * Blog topics. Slugs and names mirror apps/crawler/src/job_crawler/blog/topics.py (the crawler
 * tags articles with them); change both together. `jobsHref` is the job search each topic page
 * links to, so blog readers land in the catalogue.
 */
export interface BlogTopic {
  slug: string;
  name: string;
  description: string;
  jobsHref: string;
  jobsLabel: string;
}

export const BLOG_TOPICS: readonly BlogTopic[] = [
  {
    slug: "hiring",
    name: "Hiring & recruitment",
    description:
      "How companies hire: recruiting trends, interviews, talent acquisition and hiring demand, from labour economists and HR newsrooms.",
    jobsHref: "/?q=recruiter",
    jobsLabel: "Browse recruiter and talent jobs",
  },
  {
    slug: "labour-market",
    name: "Labour market & jobs data",
    description:
      "Jobs reports, openings, quits, wages and unemployment: the numbers behind the job market, with official statistics republished in full.",
    jobsHref: "/?posted=7",
    jobsLabel: "See jobs posted this week",
  },
  {
    slug: "careers",
    name: "Careers & skills",
    description:
      "Career moves, skills, salaries and job searching: reading for anyone planning their next role.",
    jobsHref: "/?posted=7",
    jobsLabel: "See jobs posted this week",
  },
  {
    slug: "remote-work",
    name: "Remote & hybrid work",
    description: "Remote, hybrid and return-to-office: how and where people work, and what it means for job seekers.",
    jobsHref: "/?remote=true",
    jobsLabel: "Browse remote jobs",
  },
  {
    slug: "tech-industry",
    name: "Tech industry trends",
    description: "Layoffs, AI and the software industry: the trends shaping tech hiring.",
    jobsHref: "/?q=software%20engineer",
    jobsLabel: "Browse software engineering jobs",
  },
];

const BY_SLUG = new Map(BLOG_TOPICS.map((t) => [t.slug, t]));

export function topicBySlug(slug: string): BlogTopic | undefined {
  return BY_SLUG.get(slug);
}

export function topicName(slug: string): string {
  return BY_SLUG.get(slug)?.name ?? slug;
}

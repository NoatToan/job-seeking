/**
 * Technologies the crawler detects in job postings (apps/crawler/src/job_crawler/techstack.py
 * — keep the ids in sync). Frontend and backend first; the order here is the order of the
 * filter chips and of icons on a job row.
 */
export type TechCategory = "frontend" | "backend" | "mobile" | "database" | "cloud";

export interface TechInfo {
  id: string;
  label: string;
  category: TechCategory;
}

export const TECH_STACK: readonly TechInfo[] = [
  { id: "react", label: "React", category: "frontend" },
  { id: "nextjs", label: "Next.js", category: "frontend" },
  { id: "vue", label: "Vue", category: "frontend" },
  { id: "nuxt", label: "Nuxt", category: "frontend" },
  { id: "angular", label: "Angular", category: "frontend" },
  { id: "svelte", label: "Svelte", category: "frontend" },
  { id: "typescript", label: "TypeScript", category: "frontend" },
  { id: "javascript", label: "JavaScript", category: "frontend" },
  { id: "tailwind", label: "Tailwind", category: "frontend" },
  { id: "redux", label: "Redux", category: "frontend" },
  { id: "nodejs", label: "Node.js", category: "backend" },
  { id: "nestjs", label: "NestJS", category: "backend" },
  { id: "express", label: "Express", category: "backend" },
  { id: "python", label: "Python", category: "backend" },
  { id: "django", label: "Django", category: "backend" },
  { id: "fastapi", label: "FastAPI", category: "backend" },
  { id: "flask", label: "Flask", category: "backend" },
  { id: "java", label: "Java", category: "backend" },
  { id: "spring", label: "Spring", category: "backend" },
  { id: "go", label: "Go", category: "backend" },
  { id: "rust", label: "Rust", category: "backend" },
  { id: "ruby", label: "Ruby", category: "backend" },
  { id: "rails", label: "Rails", category: "backend" },
  { id: "php", label: "PHP", category: "backend" },
  { id: "laravel", label: "Laravel", category: "backend" },
  { id: "dotnet", label: ".NET", category: "backend" },
  { id: "csharp", label: "C#", category: "backend" },
  { id: "elixir", label: "Elixir", category: "backend" },
  { id: "scala", label: "Scala", category: "backend" },
  { id: "graphql", label: "GraphQL", category: "backend" },
  { id: "react-native", label: "React Native", category: "mobile" },
  { id: "flutter", label: "Flutter", category: "mobile" },
  { id: "swift", label: "Swift", category: "mobile" },
  { id: "kotlin", label: "Kotlin", category: "mobile" },
  { id: "postgresql", label: "PostgreSQL", category: "database" },
  { id: "mysql", label: "MySQL", category: "database" },
  { id: "mongodb", label: "MongoDB", category: "database" },
  { id: "redis", label: "Redis", category: "database" },
  { id: "kafka", label: "Kafka", category: "database" },
  { id: "aws", label: "AWS", category: "cloud" },
  { id: "gcp", label: "Google Cloud", category: "cloud" },
  { id: "azure", label: "Azure", category: "cloud" },
  { id: "docker", label: "Docker", category: "cloud" },
  { id: "kubernetes", label: "Kubernetes", category: "cloud" },
  { id: "terraform", label: "Terraform", category: "cloud" },
];

const BY_ID = new Map(TECH_STACK.map((t) => [t.id, t]));
const ORDER = new Map(TECH_STACK.map((t, i) => [t.id, i]));

export function techInfo(id: string): TechInfo {
  return BY_ID.get(id) ?? { id, label: id, category: "backend" };
}

/** Sorts tech ids into catalogue order (frontend, backend, mobile, data, cloud). */
export function sortTech(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999));
}

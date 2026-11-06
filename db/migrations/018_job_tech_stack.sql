-- Technologies a job asks for (ids like 'react', 'nextjs', 'python'), derived by the crawler from
-- title, tags and description (apps/crawler/src/job_crawler/techstack.py). NULL = none found.
-- Backs the tech icons on job rows and the tech filter (`tech_stack @> ARRAY[...]`).
ALTER TABLE jobs ADD COLUMN tech_stack TEXT[];
CREATE INDEX jobs_tech_stack_idx ON jobs USING GIN (tech_stack);

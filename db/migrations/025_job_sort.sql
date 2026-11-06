-- Sort options for the job lists (`GET /api/jobs` / `GET /api/feed` `sort=`, docs/DECISIONS.md
-- "Job list sort options").
--
-- `salary_usd_year`: the top of the structured salary (migration 019: `salary_max`, else
-- `salary_min`) as a whole number of US dollars per year, so "Highest salary" can compare a VND
-- monthly wage with a EUR yearly one. Annualised like job_crawler.salary `Salary.yearly`
-- (hour x 2080, day x 260, week x 52, month x 12) and converted with ROUGH fixed rates (units per
-- USD, late 2026) — good enough to rank, never shown as a converted amount. NULL when there is no
-- structured salary, or its currency / period is unknown: those jobs sort last.
-- To change a rate, add a migration that drops and re-adds this column (and its index).
ALTER TABLE jobs ADD COLUMN salary_usd_year BIGINT GENERATED ALWAYS AS (
  CASE WHEN salary_source IS NOT NULL THEN
    round(
      coalesce(salary_max, salary_min)
      * CASE salary_period
          WHEN 'year' THEN 1 WHEN 'month' THEN 12 WHEN 'week' THEN 52
          WHEN 'day' THEN 260 WHEN 'hour' THEN 2080
        END
      / CASE salary_currency
          WHEN 'USD' THEN 1 WHEN 'EUR' THEN 0.92 WHEN 'GBP' THEN 0.79 WHEN 'CHF' THEN 0.88
          WHEN 'AUD' THEN 1.52 WHEN 'NZD' THEN 1.68 WHEN 'CAD' THEN 1.38 WHEN 'SGD' THEN 1.34
          WHEN 'HKD' THEN 7.8 WHEN 'VND' THEN 25500 WHEN 'INR' THEN 85 WHEN 'JPY' THEN 150
          WHEN 'KRW' THEN 1380 WHEN 'IDR' THEN 16000 WHEN 'MYR' THEN 4.5 WHEN 'THB' THEN 35
          WHEN 'PHP' THEN 57 WHEN 'CNY' THEN 7.2 WHEN 'RMB' THEN 7.2 WHEN 'PLN' THEN 4
          WHEN 'CZK' THEN 23 WHEN 'HUF' THEN 360 WHEN 'SEK' THEN 10.5 WHEN 'NOK' THEN 10.8
          WHEN 'DKK' THEN 6.9 WHEN 'BRL' THEN 5.5 WHEN 'MXN' THEN 18 WHEN 'ZAR' THEN 18
          WHEN 'AED' THEN 3.67
        END
    )::bigint
  END
) STORED;

-- Keyset order of `sort=salary`: (coalesce(salary_usd_year, -1), posted-or-first-seen, id), all
-- descending — the same expressions apps/api/src/ujc_api/job_sort.py orders and pages by.
CREATE INDEX jobs_salary_sort_idx
  ON jobs ((coalesce(salary_usd_year, -1)) DESC, (coalesce(posted_at, first_seen_at)) DESC, id DESC);

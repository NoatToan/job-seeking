-- Canva's Greenhouse board returns 404 (they moved ATS).
UPDATE company_boards SET enabled = FALSE WHERE ats = 'greenhouse' AND slug = 'canva';

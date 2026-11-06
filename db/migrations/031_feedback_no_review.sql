-- Feedback no longer waits for an admin: new submissions start as 'approved' (contributor-box
-- router `initial_status`, host apps/api/src/ujc_api/routers/feedback.py). Move what was already
-- waiting onto the roadmap's "Under consideration" column too, with a history entry.
INSERT INTO feedback_notes (item_id, author_id, kind, visibility, body, from_status, to_status)
SELECT id, NULL, 'status', 'public', 'status changed', status, 'approved'
FROM feedback_items
WHERE status IN ('new', 'under_review');

UPDATE feedback_items
SET status = 'approved', status_changed_at = now(), updated_at = now()
WHERE status IN ('new', 'under_review');

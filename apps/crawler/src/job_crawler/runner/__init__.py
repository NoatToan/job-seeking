"""Companion runner (M3-07): pairs this machine with a job-seeking account over the API (no
`DATABASE_URL` needed here), then reuses `job_crawler.session` to crawl the account's keyword
preferences and upload results. See `python -m job_crawler.runner --help`."""

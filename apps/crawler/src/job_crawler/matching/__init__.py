"""CV -> structured profile -> cheap keyword prefilter -> Claude fit score per job.

Ported from the jobflow POC. Claude runs through the local `claude -p` CLI (the user's Claude
subscription, no API key), so this runs on the user's machine like the session crawler.
"""

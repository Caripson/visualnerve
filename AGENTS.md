# Repository workflow

Work directly on `main`. Do not create feature branches or worktrees unless the user explicitly requests them.

Run the checks relevant to the change before committing. Keep API, MCP, OpenAPI and user documentation consistent when changing supported behavior.

Production deployment to S3 and CloudFront is manual through **Deploy S3 → Run workflow**. Do not trigger deployment automatically after a commit or push.

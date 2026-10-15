---
title: Building API Endpoints
description: Removed — the hand-written public posts walkthrough no longer matches the codebase.
order: 1
---

This walkthrough built a public posts API (`/posts`, `/posts/{id}`, `/posts/mine`), which was removed from this codebase when the API was trimmed to Mockyard. To add a public module, scaffold it with the [Module Generator](/generators/module-generate/) and follow the layering in [Core Conventions](/architecture/conventions/); `apps/api/src/modules/{workspaces,mocks,usage}` are the live hand-written examples, and posts remain editable only through the admin CRUD (`/admin/posts`).

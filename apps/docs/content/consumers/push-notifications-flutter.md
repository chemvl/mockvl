---
title: Push Notifications from Flutter
description: Removed — the client-facing device registration and notification inbox endpoints no longer exist.
order: 2
---

The client-facing push endpoints (device registration under `/devices` and the user notification inbox under `/notifications`) were removed from this codebase when the API was trimmed to Mockyard, so there is no Flutter integration contract anymore. What remains is the admin side — the notifications console, the `push-send` worker, and the FCM client — described in [Notifications System](/guides/notifications-system/).

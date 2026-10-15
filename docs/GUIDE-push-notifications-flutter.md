# Push Notifications — Flutter Integration Guide

The public app-facing push API this guide documented (device registration under
`/devices` and the user inbox under `/notifications`) was removed from this
codebase. What remains is the admin push console (`/admin/notifications`), the
`push-send` worker, and the FCM client — see
[GUIDE-notifications-system.md](./GUIDE-notifications-system.md); FCM data
payloads still carry the reserved keys `notificationId` and (when set)
`deepLink`.

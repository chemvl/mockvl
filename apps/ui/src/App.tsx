import { BrowserRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@/components/Toast/ToastProvider";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { AccessTokensPage } from "@/pages/access-tokens/AccessTokensPage";
import { AcceptInvitePage } from "@/pages/invite/AcceptInvitePage";
import { LoginPage } from "@/pages/login/LoginPage";
import { MembersPage } from "@/pages/members/MembersPage";
import { EndpointEditorPage } from "@/pages/mock/EndpointEditorPage";
import { EndpointsTab } from "@/pages/mock/EndpointsTab";
import { MockRoute } from "@/pages/mock/MockLayout";
import { SettingsTab } from "@/pages/mock/SettingsTab";
import { VersionsTab } from "@/pages/mock/VersionsTab";
import { NewMockPage } from "@/pages/new-mock/NewMockPage";
import { ResourcesPage } from "@/pages/resources/ResourcesPage";
import { UsagePage } from "@/pages/usage/UsagePage";
import { AppLayout } from "@/pages/workspace/AppLayout";
import { NotFoundPage } from "@/pages/workspace/NotFound";
import { WorkspaceRedirect } from "@/pages/workspace/WorkspaceRedirect";
import { WorkspaceSettingsPage } from "@/pages/workspace-settings/WorkspaceSettingsPage";

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<WorkspaceRedirect />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route path=":ws" element={<AppLayout />}>
              <Route index element={<ResourcesPage />} />
              <Route path="new" element={<NewMockPage />} />
              <Route path="usage" element={<UsagePage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="access-tokens" element={<AccessTokensPage />} />
              <Route path="settings" element={<WorkspaceSettingsPage />} />
              <Route path=":slug" element={<MockRoute />}>
                <Route index element={<EndpointsTab />} />
                <Route path="endpoints/new" element={<EndpointEditorPage />} />
                <Route path="endpoints/edit" element={<EndpointEditorPage />} />
                <Route path="versions" element={<VersionsTab />} />
                <Route path="settings" element={<SettingsTab />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

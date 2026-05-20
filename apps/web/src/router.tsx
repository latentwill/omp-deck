import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ChatView } from "./views/ChatView";
import { TasksView } from "./views/TasksView";
import { RoutinesView } from "./views/RoutinesView";
import { InboxView } from "./views/InboxView";
import { MarketplaceView } from "./views/MarketplaceView";
import { KbView } from "./views/KbView";
import { SkillsView } from "./views/SkillsView";
import { SettingsView } from "./views/SettingsView";

const router = createBrowserRouter([
	{ path: "/", element: <ChatView /> },
	{ path: "/tasks", element: <TasksView /> },
	{ path: "/routines", element: <RoutinesView /> },
	{ path: "/inbox", element: <InboxView /> },
	{ path: "/marketplace", element: <MarketplaceView /> },
	{ path: "/skills", element: <SkillsView /> },
	{ path: "/kb", element: <KbView /> },
	{ path: "/settings", element: <SettingsView /> },
]);

export function AppRouter() {
	return <RouterProvider router={router} />;
}

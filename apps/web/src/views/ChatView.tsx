import { Layout } from "@/components/Layout";
import { Sidebar } from "@/components/Sidebar";
import { Chat } from "@/components/Chat";
import { Composer } from "@/components/Composer";
import { Inspector } from "@/components/Inspector";
import { StatusBar } from "@/components/chrome/StatusBar";

export function ChatView() {
	return (
		<Layout
			sidebar={<Sidebar />}
			main={
				<div className="flex h-full min-h-0 flex-col">
					<Chat />
					<Composer />
				</div>
			}
			inspector={<Inspector />}
			topBar={<StatusBar />}
		/>
	);
}

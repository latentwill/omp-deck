import { useEffect } from "react";
import { AppRouter } from "./router";
import { useStore } from "./lib/store";

export function App() {
	const bootstrap = useStore((s) => s.bootstrap);

	useEffect(() => {
		void bootstrap();
	}, [bootstrap]);

	return <AppRouter />;
}

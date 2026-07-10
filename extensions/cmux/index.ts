import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerSidebarHandlers } from "./sidebar";
import { createNotifyTracker, registerNotifyHandlers } from "./notify";

export default function cmuxExtension(pi: ExtensionAPI) {
	pi.setLabel("cmux");

	// Session Visibility handlers are always registered. Runtime availability
	// is checked inside cmux() so the extension can attach after load.
	const tracker = createNotifyTracker();
	registerSidebarHandlers(pi);
	registerNotifyHandlers(pi, tracker);
}

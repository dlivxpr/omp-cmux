import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerSidebarHandlers } from "./sidebar";
import { createNotifyTracker, registerNotifyHandlers } from "./notify";
import { registerCommands } from "./commands";

export default function cmuxExtension(pi: ExtensionAPI) {
	pi.setLabel("cmux");

	// Commands, sidebar, and notifications are always registered. Runtime
	// availability is checked inside cmux() so the extension works when cmux
	// becomes available after load.
	registerCommands(pi);

	const tracker = createNotifyTracker();
	registerSidebarHandlers(pi);
	registerNotifyHandlers(pi, tracker);
}

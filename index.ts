import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { isCmuxAvailable } from "./cmux";
import { registerSidebarHandlers } from "./sidebar";
import { createNotifyTracker, registerNotifyHandlers } from "./notify";
import { registerCommands } from "./commands";

export default function cmuxExtension(pi: ExtensionAPI) {
	pi.setLabel("cmux");

	// Commands are always registered; they gracefully no-op when cmux is absent
	// because cmux() internally checks isCmuxAvailable().
	registerCommands(pi);

	if (!isCmuxAvailable()) {
		return;
	}

	const tracker = createNotifyTracker();
	registerSidebarHandlers(pi);
	registerNotifyHandlers(pi, tracker);
}

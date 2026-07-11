import { expect, it } from "bun:test";
import cmuxExtension from "./index";

it("registers Session Visibility handlers without Session Orchestration commands", () => {
	const commands: string[] = [];
	const events: string[] = [];
	let label: string | undefined;
	const pi = {
		setLabel(value: string) {
			label = value;
		},
		registerCommand(name: string) {
			commands.push(name);
		},
		on(event: string) {
			events.push(event);
		},
	};

	cmuxExtension(pi as never);

	expect(label).toBe("cmux");
	expect(commands).toEqual([]);
	expect(events).toContain("agent_start");
	expect(events).toContain("agent_end");
	expect(events).toContain("tool_result");
	expect(events).toContain("turn_end");
	expect(events).toContain("session_switch");
	expect(events).toContain("session_branch");
	expect(events).toContain("session_tree");
	expect(events).toContain("session_shutdown");
});

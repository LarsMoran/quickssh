import { invoke } from "@tauri-apps/api/core";

const ACTIVE_MODULE_STORAGE_KEY = "quickssh.active-module";
const DEVTOOLS_ENVIRONMENTS = [
	{
		id: "core-platform",
		name: "Core Platform",
		description:
			"Shared local stack for gateway, auth and platform APIs used by most product teams.",
		workspace: "~/work/platform",
		composePath: "~/work/platform/dev/docker-compose.yml",
		projectName: "platform-dev",
		services: [
			{
				id: "gateway",
				name: "gateway",
				composeService: "gateway",
				role: "edge",
				summary: "Public ingress and route composition layer.",
				ports: ["8080", "8443"],
				endpoints: ["http://localhost:8080"],
			},
			{
				id: "identity",
				name: "identity",
				composeService: "identity",
				role: "auth",
				summary: "Company identity provider and token issuing service.",
				ports: ["8091"],
				endpoints: ["http://localhost:8091"],
			},
			{
				id: "postgres",
				name: "postgres",
				composeService: "postgres",
				role: "data",
				summary: "Primary relational storage for platform services.",
				ports: ["5432"],
				endpoints: [],
			},
			{
				id: "redpanda",
				name: "redpanda",
				composeService: "redpanda",
				role: "stream",
				summary: "Kafka-compatible event backbone for local testing.",
				ports: ["9092", "9644"],
				endpoints: [],
			},
		],
	},
	{
		id: "analytics-lab",
		name: "Analytics Lab",
		description:
			"Focused stack for analysts and backend developers working with pipelines, BI and replay jobs.",
		workspace: "~/work/analytics",
		composePath: "~/work/analytics/docker/docker-compose.yml",
		projectName: "analytics-lab",
		services: [
			{
				id: "collector",
				name: "collector",
				composeService: "collector",
				role: "ingest",
				summary: "Accepts raw events and publishes normalized records.",
				ports: ["8070"],
				endpoints: ["http://localhost:8070/health"],
			},
			{
				id: "warehouse",
				name: "warehouse",
				composeService: "warehouse",
				role: "storage",
				summary: "OLAP-compatible warehouse node for local datasets.",
				ports: ["8123", "9000"],
				endpoints: ["http://localhost:8123"],
			},
			{
				id: "metabase",
				name: "metabase",
				composeService: "metabase",
				role: "bi",
				summary: "Ad-hoc BI and dashboarding surface for QA datasets.",
				ports: ["3001"],
				endpoints: ["http://localhost:3001"],
			},
		],
	},
	{
		id: "frontend-workbench",
		name: "Frontend Workbench",
		description:
			"UI-oriented environment with mock APIs, edge adapters and shared frontend dependencies.",
		workspace: "~/work/frontend-workbench",
		composePath: "~/work/frontend-workbench/compose/devtools.yml",
		projectName: "frontend-workbench",
		services: [
			{
				id: "storybook",
				name: "storybook",
				composeService: "storybook",
				role: "ui",
				summary: "Component playground and visual regression baseline.",
				ports: ["6006"],
				endpoints: ["http://localhost:6006"],
			},
			{
				id: "mock-api",
				name: "mock-api",
				composeService: "mock-api",
				role: "mock",
				summary: "Local API stub with company auth/session fixtures.",
				ports: ["4010"],
				endpoints: ["http://localhost:4010"],
			},
			{
				id: "assets",
				name: "assets",
				composeService: "assets",
				role: "cdn",
				summary: "Static asset proxy for local UI builds.",
				ports: ["4173"],
				endpoints: ["http://localhost:4173"],
			},
		],
	},
];

function loadInitialModule() {
	try {
		const stored = window.localStorage.getItem(ACTIVE_MODULE_STORAGE_KEY);
		return stored === "devtools" ? "devtools" : "quickssh";
	} catch {
		return "quickssh";
	}
}

const state = {
	activeModule: loadInitialModule(),
	hosts: [],
	selectedHostId: null,
	editingHostId: null,
	containers: [],
	containerSearchQuery: "",
	activeForwards: [],
	openContainerMenuId: null,
	busyCount: 0,
	devtools: {
		selectedEnvironmentId: DEVTOOLS_ENVIRONMENTS[0].id,
		selectedServiceId: DEVTOOLS_ENVIRONMENTS[0].services[0].id,
		serviceQuery: "",
	},
	inspectView: {
		hostId: null,
		containerId: null,
		containerName: "",
		rawText: "",
		searchQuery: "",
		matchOffsets: [],
		activeMatchIndex: 0,
	},
	logsView: {
		hostId: null,
		containerId: null,
		containerName: "",
		follow: true,
		since: null,
		pollTimer: null,
	},
};

const NAME_PALETTE = [
	"#0f766e",
	"#1d4ed8",
	"#b45309",
	"#7c3aed",
	"#be123c",
	"#0e7490",
	"#15803d",
	"#c2410c",
];

const elements = {
	moduleTriggers: [...document.querySelectorAll("[data-module-target]")],
	quicksshModule: document.querySelector("#module-quickssh"),
	devtoolsModule: document.querySelector("#module-devtools"),
	hostsList: document.querySelector("#hosts-list"),
	hostForm: document.querySelector("#host-form"),
	formTitle: document.querySelector("#form-title"),
	hostName: document.querySelector("#host-name"),
	hostTarget: document.querySelector("#host-target"),
	hostNotes: document.querySelector("#host-notes"),
	saveHost: document.querySelector("#save-host"),
	resetHost: document.querySelector("#reset-host"),
	activeHostName: document.querySelector("#active-host-name"),
	activeHostTarget: document.querySelector("#active-host-target"),
	refreshContainers: document.querySelector("#refresh-containers"),
	containerSearch: document.querySelector("#container-search"),
	containerCount: document.querySelector("#container-count"),
	containersBody: document.querySelector("#containers-body"),
	forwardCount: document.querySelector("#forward-count"),
	forwardsList: document.querySelector("#forwards-list"),
	devtoolsEnvironments: document.querySelector("#devtools-environments"),
	devtoolsTitle: document.querySelector("#devtools-title"),
	devtoolsSummary: document.querySelector("#devtools-summary"),
	devtoolsUp: document.querySelector("#devtools-up"),
	devtoolsDown: document.querySelector("#devtools-down"),
	devtoolsLogs: document.querySelector("#devtools-logs"),
	devtoolsServiceSearch: document.querySelector("#devtools-service-search"),
	devtoolsServiceCount: document.querySelector("#devtools-service-count"),
	devtoolsServices: document.querySelector("#devtools-services"),
	devtoolsDetailTitle: document.querySelector("#devtools-detail-title"),
	devtoolsDetailMeta: document.querySelector("#devtools-detail-meta"),
	devtoolsDetail: document.querySelector("#devtools-detail"),
	devtoolsNotice: document.querySelector("#devtools-notice"),
	logsModal: document.querySelector("#logs-modal"),
	logsSubtitle: document.querySelector("#logs-subtitle"),
	logsOutput: document.querySelector("#logs-output"),
	logsClose: document.querySelector("#logs-close"),
	logsRefresh: document.querySelector("#logs-refresh"),
	logsFollow: document.querySelector("#logs-follow"),
	inspectModal: document.querySelector("#inspect-modal"),
	inspectSubtitle: document.querySelector("#inspect-subtitle"),
	inspectOutput: document.querySelector("#inspect-output"),
	inspectSearch: document.querySelector("#inspect-search"),
	inspectSearchCount: document.querySelector("#inspect-search-count"),
	inspectSearchPrev: document.querySelector("#inspect-search-prev"),
	inspectSearchNext: document.querySelector("#inspect-search-next"),
	inspectClose: document.querySelector("#inspect-close"),
	notice: document.querySelector("#notice"),
	busyOverlay: document.querySelector("#busy-overlay"),
	busyMessage: document.querySelector("#busy-message"),
};

function setNotice(message, level = "info") {
	elements.notice.textContent = message;
	elements.notice.dataset.level = level;
}

function clearNotice() {
	elements.notice.textContent = "";
	elements.notice.dataset.level = "";
}

function setDevtoolsNotice(message, level = "info") {
	elements.devtoolsNotice.textContent = message;
	elements.devtoolsNotice.dataset.level = level;
}

function clearDevtoolsNotice() {
	elements.devtoolsNotice.textContent = "";
	elements.devtoolsNotice.dataset.level = "";
}

function persistActiveModule() {
	try {
		window.localStorage.setItem(ACTIVE_MODULE_STORAGE_KEY, state.activeModule);
	} catch {
		return;
	}
}

function beginBusy(message = "Working...") {
	state.busyCount += 1;
	elements.busyMessage.textContent = message;
	elements.busyOverlay.classList.remove("hidden");
}

function endBusy() {
	state.busyCount = Math.max(0, state.busyCount - 1);
	if (state.busyCount === 0) {
		elements.busyMessage.textContent = "Working...";
		elements.busyOverlay.classList.add("hidden");
	}
}

function currentHost() {
	return state.hosts.find((host) => host.id === state.selectedHostId) ?? null;
}

function currentDevtoolsEnvironment() {
	return (
		DEVTOOLS_ENVIRONMENTS.find(
			(environment) => environment.id === state.devtools.selectedEnvironmentId,
		) ?? DEVTOOLS_ENVIRONMENTS[0]
	);
}

function environmentCommands(environment) {
	const compose = `docker compose -p ${environment.projectName} -f ${environment.composePath}`;
	return {
		up: `${compose} up -d --build`,
		down: `${compose} down --remove-orphans`,
		logs: `${compose} logs -f`,
	};
}

function serviceCommands(environment, service) {
	const compose = `docker compose -p ${environment.projectName} -f ${environment.composePath}`;
	return {
		logs: `${compose} logs -f ${service.composeService}`,
		restart: `${compose} restart ${service.composeService}`,
		shell: `${compose} exec ${service.composeService} sh`,
	};
}

function filteredDevtoolsServices() {
	const environment = currentDevtoolsEnvironment();
	const query = state.devtools.serviceQuery.trim().toLowerCase();
	if (!query) {
		return environment.services;
	}

	return environment.services.filter((service) => {
		const haystack = [
			service.name,
			service.role,
			service.summary,
			...(service.ports ?? []),
		]
			.join(" ")
			.toLowerCase();
		return haystack.includes(query);
	});
}

function syncDevtoolsSelection() {
	const environment = currentDevtoolsEnvironment();
	if (!environment) {
		return;
	}

	const exists = environment.services.some(
		(service) => service.id === state.devtools.selectedServiceId,
	);
	if (!exists) {
		state.devtools.selectedServiceId = environment.services[0]?.id ?? null;
	}
}

function currentDevtoolsService() {
	syncDevtoolsSelection();
	return (
		currentDevtoolsEnvironment().services.find(
			(service) => service.id === state.devtools.selectedServiceId,
		) ?? null
	);
}

function renderModuleShell() {
	for (const trigger of elements.moduleTriggers) {
		const isActive = trigger.dataset.moduleTarget === state.activeModule;
		trigger.classList.toggle("active", isActive);
	}

	elements.quicksshModule.classList.toggle(
		"hidden",
		state.activeModule !== "quickssh",
	);
	elements.devtoolsModule.classList.toggle(
		"hidden",
		state.activeModule !== "devtools",
	);
}

function renderDevtoolsEnvironmentList() {
	const fragment = document.createDocumentFragment();
	elements.devtoolsEnvironments.innerHTML = "";

	for (const environment of DEVTOOLS_ENVIRONMENTS) {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "devtools-environment-item";
		button.dataset.environmentId = environment.id;
		if (environment.id === state.devtools.selectedEnvironmentId) {
			button.classList.add("active");
		}

		const title = document.createElement("h3");
		title.textContent = environment.name;

		const description = document.createElement("p");
		description.className = "muted";
		description.textContent = environment.description;

		const meta = document.createElement("p");
		meta.className = "muted";
		meta.textContent = `${environment.services.length} services · ${environment.workspace}`;

		button.append(title, description, meta);
		item.append(button);
		fragment.append(item);
	}

	elements.devtoolsEnvironments.append(fragment);
}

function renderDevtoolsServices() {
	const services = filteredDevtoolsServices();
	const environment = currentDevtoolsEnvironment();
	elements.devtoolsServices.innerHTML = "";
	elements.devtoolsServiceCount.textContent = `${services.length}/${environment.services.length} services`;

	if (services.length === 0) {
		const empty = document.createElement("div");
		empty.className = "host-empty muted";
		empty.textContent = "No services match the current search.";
		elements.devtoolsServices.append(empty);
		return;
	}

	const fragment = document.createDocumentFragment();
	for (const service of services) {
		const card = document.createElement("button");
		card.type = "button";
		card.className = "devtools-service-card";
		card.dataset.serviceId = service.id;
		if (service.id === state.devtools.selectedServiceId) {
			card.classList.add("active");
		}

		const top = document.createElement("div");
		top.className = "devtools-service-top";

		const name = document.createElement("h3");
		name.textContent = service.name;

		const role = document.createElement("span");
		role.className = "devtools-service-role";
		role.textContent = service.role;
		top.append(name, role);

		const summary = document.createElement("p");
		summary.className = "muted";
		summary.textContent = service.summary;

		const ports = document.createElement("div");
		ports.className = "devtools-service-ports";
		if ((service.ports ?? []).length === 0) {
			const emptyPort = document.createElement("span");
			emptyPort.className = "muted";
			emptyPort.textContent = "No exposed ports";
			ports.append(emptyPort);
		} else {
			for (const port of service.ports) {
				const pill = document.createElement("span");
				pill.className = "devtools-port-pill";
				pill.textContent = port;
				ports.append(pill);
			}
		}

		card.append(top, summary, ports);
		fragment.append(card);
	}

	elements.devtoolsServices.append(fragment);
}

function renderDevtoolsDetail() {
	const environment = currentDevtoolsEnvironment();
	const service = currentDevtoolsService();

	if (!service) {
		elements.devtoolsDetailTitle.textContent = "Service Runbook";
		elements.devtoolsDetailMeta.textContent = "No service selected";
		elements.devtoolsDetail.innerHTML =
			'<div class="host-empty muted">Select a service to inspect commands, endpoints and the local compose context.</div>';
		return;
	}

	const commands = serviceCommands(environment, service);
	const endpoints =
		service.endpoints.length > 0
			? service.endpoints.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")
			: '<li class="muted">No HTTP endpoints declared.</li>';
	const ports =
		service.ports.length > 0
			? service.ports
					.map(
						(entry) =>
							`<span class="devtools-port-pill">${escapeHtml(entry)}</span>`,
					)
					.join("")
			: '<span class="muted">No exposed ports</span>';

	elements.devtoolsDetailTitle.textContent = service.name;
	elements.devtoolsDetailMeta.textContent = `${service.role} · ${environment.name}`;
	elements.devtoolsDetail.innerHTML = `
		<section class="devtools-detail-block">
			<h4>Purpose</h4>
			<p>${escapeHtml(service.summary)}</p>
		</section>
		<section class="devtools-detail-block">
			<h4>Compose Context</h4>
			<pre class="devtools-command">${escapeHtml(environment.composePath)}</pre>
		</section>
		<section class="devtools-detail-block">
			<h4>Workspace</h4>
			<pre class="devtools-command">${escapeHtml(environment.workspace)}</pre>
		</section>
		<section class="devtools-detail-block">
			<h4>Ports</h4>
			<div class="devtools-service-ports">${ports}</div>
		</section>
		<section class="devtools-detail-block">
			<h4>Endpoints</h4>
			<ul>${endpoints}</ul>
		</section>
		<section class="devtools-detail-block">
			<h4>Commands</h4>
			<pre class="devtools-command">${escapeHtml(commands.logs)}</pre>
			<pre class="devtools-command">${escapeHtml(commands.restart)}</pre>
			<pre class="devtools-command">${escapeHtml(commands.shell)}</pre>
			<div class="devtools-detail-actions">
				<button type="button" class="ghost" data-devtools-command="${escapeHtml(commands.logs)}" data-devtools-label="Logs command copied.">Copy Logs</button>
				<button type="button" class="ghost" data-devtools-command="${escapeHtml(commands.restart)}" data-devtools-label="Restart command copied.">Copy Restart</button>
				<button type="button" class="ghost" data-devtools-command="${escapeHtml(commands.shell)}" data-devtools-label="Shell command copied.">Copy Shell</button>
			</div>
		</section>
	`;
}

function renderDevtoolsOverview() {
	const environment = currentDevtoolsEnvironment();
	const commands = environmentCommands(environment);
	elements.devtoolsTitle.textContent = environment.name;
	elements.devtoolsSummary.textContent = `${environment.description} Workspace: ${environment.workspace}`;
	elements.devtoolsUp.dataset.command = commands.up;
	elements.devtoolsUp.dataset.notice = "Up command copied.";
	elements.devtoolsDown.dataset.command = commands.down;
	elements.devtoolsDown.dataset.notice = "Down command copied.";
	elements.devtoolsLogs.dataset.command = commands.logs;
	elements.devtoolsLogs.dataset.notice = "Logs command copied.";
}

function renderDevtoolsModule() {
	syncDevtoolsSelection();
	renderDevtoolsEnvironmentList();
	renderDevtoolsOverview();
	renderDevtoolsServices();
	renderDevtoolsDetail();
}

async function copyToClipboard(text, successMessage) {
	if (!text) {
		setDevtoolsNotice("Nothing to copy for the current selection.", "error");
		return;
	}

	try {
		await navigator.clipboard.writeText(text);
		setDevtoolsNotice(successMessage);
	} catch (error) {
		setDevtoolsNotice(
			`Clipboard is unavailable. Command: ${text}`,
			"error",
		);
	}
}

function switchModule(moduleId) {
	if (moduleId !== "quickssh" && moduleId !== "devtools") {
		return;
	}

	state.activeModule = moduleId;
	persistActiveModule();
	renderModuleShell();

	if (moduleId !== "quickssh") {
		closeContainerMenu();
		closeLogsModal();
		closeInspectModal();
	}
}

function colorFromSeed(seed) {
	let hash = 0;
	for (let i = 0; i < seed.length; i += 1) {
		hash = (hash << 5) - hash + seed.charCodeAt(i);
		hash |= 0;
	}

	const index = Math.abs(hash) % NAME_PALETTE.length;
	return NAME_PALETTE[index];
}

function containerNameColor(statusText) {
	const status = (statusText || "").toLowerCase();

	if (status.includes("up") || status.includes("running")) {
		return "#15803d";
	}

	if (
		status.includes("restart") ||
		status.includes("exited") ||
		status.includes("dead") ||
		status.includes("created") ||
		status.includes("paused")
	) {
		return "#b91c1c";
	}

	return "#334155";
}

function parsePort(portText, label) {
	const value = Number.parseInt((portText || "").trim(), 10);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`${label} must be an integer from 1 to 65535.`);
	}
	return value;
}

function extractPortCandidates(portsText) {
	const text = (portsText || "").trim();
	if (!text || text === "-") {
		return [];
	}

	const publishedPorts = [...text.matchAll(/(\d+)->\d+\/(?:tcp|udp)/gi)].map(
		(match) => Number.parseInt(match[1], 10),
	);
	if (publishedPorts.length > 0) {
		return [...new Set(publishedPorts.filter(Number.isInteger))];
	}

	const containerPorts = [
		...text.matchAll(/(?:^|,\s*)(\d+)\/(?:tcp|udp)/gi),
	].map((match) => Number.parseInt(match[1], 10));
	return [...new Set(containerPorts.filter(Number.isInteger))];
}

function setLogsText(content) {
	elements.logsOutput.textContent =
		content && content.trim().length > 0
			? content
			: "No logs for selected range.";
}

function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function renderInspectOutput() {
	const text =
		state.inspectView.rawText && state.inspectView.rawText.trim().length > 0
			? state.inspectView.rawText
			: "No inspect details available.";
	const query = state.inspectView.searchQuery.trim();

	if (!query) {
		state.inspectView.matchOffsets = [];
		state.inspectView.activeMatchIndex = 0;
		elements.inspectOutput.textContent = text;
		elements.inspectSearchCount.textContent = "0 matches";
		elements.inspectSearchPrev.disabled = true;
		elements.inspectSearchNext.disabled = true;
		return;
	}

	const textLower = text.toLowerCase();
	const queryLower = query.toLowerCase();
	const offsets = [];
	let cursor = 0;

	while (cursor <= textLower.length - queryLower.length) {
		const found = textLower.indexOf(queryLower, cursor);
		if (found === -1) {
			break;
		}
		offsets.push(found);
		cursor = found + queryLower.length;
	}

	state.inspectView.matchOffsets = offsets;
	if (offsets.length === 0) {
		state.inspectView.activeMatchIndex = 0;
		elements.inspectOutput.textContent = text;
		elements.inspectSearchCount.textContent = "0 matches";
		elements.inspectSearchPrev.disabled = true;
		elements.inspectSearchNext.disabled = true;
		return;
	}

	const activeIndex = Math.min(
		state.inspectView.activeMatchIndex,
		offsets.length - 1,
	);
	state.inspectView.activeMatchIndex = activeIndex;
	elements.inspectSearchCount.textContent = `${activeIndex + 1}/${offsets.length}`;
	elements.inspectSearchPrev.disabled = false;
	elements.inspectSearchNext.disabled = false;

	const chunks = [];
	let position = 0;
	for (let index = 0; index < offsets.length; index += 1) {
		const start = offsets[index];
		const end = start + query.length;
		const before = text.slice(position, start);
		const matched = text.slice(start, end);
		const activeClass = index === activeIndex ? ' class="active"' : "";

		chunks.push(escapeHtml(before));
		chunks.push(
			`<mark data-match-index="${index}"${activeClass}>${escapeHtml(matched)}</mark>`,
		);
		position = end;
	}
	chunks.push(escapeHtml(text.slice(position)));

	elements.inspectOutput.innerHTML = chunks.join("");
	const activeMatch = elements.inspectOutput.querySelector("mark.active");
	if (activeMatch instanceof HTMLElement) {
		activeMatch.scrollIntoView({ block: "center" });
	}
}

function setInspectText(content) {
	state.inspectView.rawText =
		content && content.trim().length > 0
			? content
			: "No inspect details available.";
	renderInspectOutput();
}

function moveInspectMatch(step) {
	const total = state.inspectView.matchOffsets.length;
	if (total === 0) {
		return;
	}
	state.inspectView.activeMatchIndex =
		(state.inspectView.activeMatchIndex + step + total) % total;
	renderInspectOutput();
}

function stopLogsPolling() {
	if (state.logsView.pollTimer) {
		window.clearInterval(state.logsView.pollTimer);
		state.logsView.pollTimer = null;
	}
}

function closeLogsModal() {
	stopLogsPolling();
	state.logsView.hostId = null;
	state.logsView.containerId = null;
	state.logsView.containerName = "";
	state.logsView.since = null;
	elements.logsModal.classList.add("hidden");
}

function closeInspectModal() {
	state.inspectView.hostId = null;
	state.inspectView.containerId = null;
	state.inspectView.containerName = "";
	state.inspectView.rawText = "";
	state.inspectView.searchQuery = "";
	state.inspectView.matchOffsets = [];
	state.inspectView.activeMatchIndex = 0;
	elements.inspectSearch.value = "";
	elements.inspectSearchCount.textContent = "0 matches";
	elements.inspectSearchPrev.disabled = true;
	elements.inspectSearchNext.disabled = true;
	elements.inspectModal.classList.add("hidden");
}

function closeContainerMenu() {
	if (state.openContainerMenuId) {
		state.openContainerMenuId = null;
		renderContainers();
	}
}

function startLogsPolling() {
	stopLogsPolling();
	if (
		!state.logsView.follow ||
		!state.logsView.containerId ||
		!state.logsView.hostId
	) {
		return;
	}

	state.logsView.pollTimer = window.setInterval(() => {
		loadContainerLogs({ reset: false }).catch((error) =>
			setNotice(String(error), "error"),
		);
	}, 2000);
}

async function loadContainerLogs({ reset }) {
	if (!state.logsView.containerId || !state.logsView.hostId) {
		return;
	}

	const requestStart = new Date().toISOString();
	const payload = {
		hostId: state.logsView.hostId,
		containerId: state.logsView.containerId,
		tail: reset ? 300 : 200,
		since: reset ? null : state.logsView.since,
	};

	const chunk = await invoke("get_container_logs", { input: payload });
	state.logsView.since = requestStart;

	if (reset) {
		setLogsText(chunk);
	} else if (chunk && chunk.trim().length > 0) {
		const suffix = elements.logsOutput.textContent.endsWith("\n") ? "" : "\n";
		elements.logsOutput.textContent =
			`${elements.logsOutput.textContent}${suffix}${chunk}`.trim();
	}

	if (state.logsView.follow) {
		elements.logsOutput.scrollTop = elements.logsOutput.scrollHeight;
	}
}

async function openLogsModal(container) {
	if (!state.selectedHostId) {
		return;
	}

	stopLogsPolling();
	state.logsView.hostId = state.selectedHostId;
	state.logsView.containerId = container.id;
	state.logsView.containerName = container.name;
	state.logsView.since = null;
	state.logsView.follow = true;

	elements.logsFollow.checked = true;
	elements.logsSubtitle.textContent = `${container.name} (${currentHost()?.name ?? "host"})`;
	setLogsText("Loading logs...");
	elements.logsModal.classList.remove("hidden");

	await loadContainerLogs({ reset: true });
	startLogsPolling();
}

async function openInspectModal(container) {
	if (!state.selectedHostId) {
		return;
	}

	state.inspectView.hostId = state.selectedHostId;
	state.inspectView.containerId = container.id;
	state.inspectView.containerName = container.name;
	state.inspectView.searchQuery = "";
	state.inspectView.matchOffsets = [];
	state.inspectView.activeMatchIndex = 0;
	elements.inspectSearch.value = "";

	elements.inspectSubtitle.textContent = `${container.name} (${currentHost()?.name ?? "host"})`;
	setInspectText("Loading inspect details...");
	elements.inspectModal.classList.remove("hidden");

	try {
		const details = await invoke("get_container_inspect", {
			input: {
				hostId: state.selectedHostId,
				containerId: container.id,
			},
		});

		setInspectText(JSON.stringify(details, null, 2));
	} catch (error) {
		setInspectText(`Failed to load inspect details.\n\n${String(error)}`);
		throw error;
	}
}

function setFormMode(host = null) {
	if (!host) {
		state.editingHostId = null;
		elements.formTitle.textContent = "Add Host";
		elements.saveHost.textContent = "Save Host";
		elements.hostForm.reset();
		return;
	}

	state.editingHostId = host.id;
	elements.formTitle.textContent = "Edit Host";
	elements.saveHost.textContent = "Update Host";
	elements.hostName.value = host.name;
	elements.hostTarget.value = host.sshTarget;
	elements.hostNotes.value = host.notes ?? "";
}

function renderHostPanel() {
	elements.hostsList.innerHTML = "";

	if (state.hosts.length === 0) {
		const placeholder = document.createElement("li");
		placeholder.className = "host-empty muted";
		placeholder.textContent = "No hosts yet. Add the first workspace below.";
		elements.hostsList.append(placeholder);
		return;
	}

	const fragment = document.createDocumentFragment();
	for (const host of state.hosts) {
		const item = document.createElement("li");
		item.className = "host-item";
		if (host.id === state.selectedHostId) {
			item.classList.add("selected");
		}

		const main = document.createElement("button");
		main.type = "button";
		main.className = "host-main";
		main.dataset.action = "select";
		main.dataset.hostId = host.id;

		const name = document.createElement("span");
		name.className = "host-name";
		name.textContent = host.name;
		name.style.color = colorFromSeed(host.id);

		const target = document.createElement("span");
		target.className = "host-target";
		target.textContent = host.sshTarget;

		main.append(name, target);

		const actions = document.createElement("div");
		actions.className = "host-actions";

		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "ghost";
		edit.dataset.action = "edit";
		edit.dataset.hostId = host.id;
		edit.textContent = "Edit";

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "ghost danger";
		remove.dataset.action = "delete";
		remove.dataset.hostId = host.id;
		remove.textContent = "Delete";

		actions.append(edit, remove);
		item.append(main, actions);
		fragment.append(item);
	}

	elements.hostsList.append(fragment);
}

function renderActiveHost() {
	const host = currentHost();
	if (!host) {
		elements.activeHostName.textContent = "No host selected";
		elements.activeHostTarget.textContent =
			"Add and select a host to inspect containers.";
		return;
	}

	elements.activeHostName.textContent = host.name;
	elements.activeHostTarget.textContent = host.sshTarget;
}

function filteredContainers() {
	const query = state.containerSearchQuery.trim().toLowerCase();
	if (!query) {
		return state.containers;
	}

	return state.containers.filter((container) => {
		const name = (container.name || "").toLowerCase();
		const ports = (container.ports || "").toLowerCase();
		return name.includes(query) || ports.includes(query);
	});
}

function renderContainers() {
	const containers = filteredContainers();
	elements.containersBody.innerHTML = "";

	const fullCount = state.containers.length;
	const shownCount = containers.length;
	const hasFilter = state.containerSearchQuery.trim().length > 0;
	elements.containerCount.textContent = hasFilter
		? `${shownCount}/${fullCount} containers`
		: `${shownCount} container${shownCount === 1 ? "" : "s"}`;

	if (!currentHost()) {
		const row = document.createElement("tr");
		row.innerHTML =
			'<td colspan="5" class="muted">Select a host to load containers.</td>';
		elements.containersBody.append(row);
		return;
	}

	if (state.containers.length === 0) {
		const row = document.createElement("tr");
		row.innerHTML =
			'<td colspan="5" class="muted">No running containers found.</td>';
		elements.containersBody.append(row);
		return;
	}

	if (containers.length === 0) {
		const row = document.createElement("tr");
		row.innerHTML =
			'<td colspan="5" class="muted">No containers match current search.</td>';
		elements.containersBody.append(row);
		return;
	}

	const fragment = document.createDocumentFragment();
	for (const container of containers) {
		const row = document.createElement("tr");

		const name = document.createElement("td");
		name.className = "container-name";
		name.textContent = container.name;
		name.style.color = containerNameColor(container.status);

		const status = document.createElement("td");
		status.textContent = container.status;

		const image = document.createElement("td");
		image.textContent = container.image;

		const ports = document.createElement("td");
		ports.textContent = container.ports || "-";

		const actionCell = document.createElement("td");
		actionCell.className = "table-action";

		const actionMenu = document.createElement("div");
		actionMenu.className = "table-action-menu";
		actionMenu.dataset.containerId = container.id;

		const menuTrigger = document.createElement("button");
		menuTrigger.type = "button";
		menuTrigger.className = "ghost menu-trigger";
		menuTrigger.dataset.action = "toggle-menu";
		menuTrigger.dataset.containerId = container.id;
		menuTrigger.setAttribute(
			"aria-label",
			`Container actions for ${container.name}`,
		);
		menuTrigger.setAttribute("title", "Container actions");
		menuTrigger.innerHTML =
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4l.5 2.1a7.8 7.8 0 0 1 1.9.8l1.9-1 2.8 2.8-1 1.9c.3.6.6 1.2.8 1.9L23 12v4l-2.1.5a7.8 7.8 0 0 1-.8 1.9l1 1.9-2.8 2.8-1.9-1a7.8 7.8 0 0 1-1.9.8L14 23h-4l-.5-2.1a7.8 7.8 0 0 1-1.9-.8l-1.9 1-2.8-2.8 1-1.9a7.8 7.8 0 0 1-.8-1.9L1 16v-4l2.1-.5c.2-.7.5-1.3.8-1.9l-1-1.9L5.7 4.9l1.9 1c.6-.3 1.2-.6 1.9-.8L10 3Z"/><circle cx="12" cy="14" r="3.2"/></svg>';

		const forwardButton = document.createElement("button");
		forwardButton.type = "button";
		forwardButton.className = "ghost";
		forwardButton.dataset.action = "forward";
		forwardButton.dataset.containerId = container.id;
		forwardButton.textContent = "Forward";

		const logsButton = document.createElement("button");
		logsButton.type = "button";
		logsButton.className = "ghost";
		logsButton.dataset.action = "logs";
		logsButton.dataset.containerId = container.id;
		logsButton.textContent = "Logs";

		const inspectButton = document.createElement("button");
		inspectButton.type = "button";
		inspectButton.className = "ghost";
		inspectButton.dataset.action = "inspect";
		inspectButton.dataset.containerId = container.id;
		inspectButton.textContent = "Inspect";

		const restartButton = document.createElement("button");
		restartButton.type = "button";
		restartButton.className = "ghost";
		restartButton.dataset.action = "restart";
		restartButton.dataset.containerId = container.id;
		restartButton.textContent = "Restart";

		const menu = document.createElement("div");
		menu.className = "container-menu";
		if (state.openContainerMenuId !== container.id) {
			menu.classList.add("hidden");
		}
		menu.append(forwardButton, logsButton, inspectButton, restartButton);

		actionMenu.append(menuTrigger, menu);
		actionCell.append(actionMenu);
		row.append(name, status, image, ports, actionCell);
		fragment.append(row);
	}

	elements.containersBody.append(fragment);
}

function renderForwards() {
	elements.forwardsList.innerHTML = "";

	if (!state.selectedHostId) {
		elements.forwardCount.textContent = "0 forwards";
		const item = document.createElement("li");
		item.className = "forward-empty muted";
		item.textContent = "Select a host to manage forwards.";
		elements.forwardsList.append(item);
		return;
	}

	elements.forwardCount.textContent = `${state.activeForwards.length} forward${state.activeForwards.length === 1 ? "" : "s"}`;

	if (state.activeForwards.length === 0) {
		const item = document.createElement("li");
		item.className = "forward-empty muted";
		item.textContent = "No active forwards for current host.";
		elements.forwardsList.append(item);
		return;
	}

	const fragment = document.createDocumentFragment();
	for (const forward of state.activeForwards) {
		const item = document.createElement("li");
		item.className = "forward-item";

		const info = document.createElement("div");
		const route = document.createElement("p");
		route.className = "forward-route";
		route.textContent = `127.0.0.1:${forward.localPort} -> ${forward.targetHost}:${forward.targetPort}`;

		const meta = document.createElement("p");
		meta.className = "forward-meta muted";
		meta.textContent = `${forward.containerName} (${forward.hostName}, requested ${forward.remotePort})`;

		info.append(route, meta);

		const stopButton = document.createElement("button");
		stopButton.type = "button";
		stopButton.className = "ghost danger";
		stopButton.dataset.action = "stop-forward";
		stopButton.dataset.forwardId = forward.id;
		stopButton.textContent = "Stop";

		item.append(info, stopButton);
		fragment.append(item);
	}

	elements.forwardsList.append(fragment);
}

async function refreshWorkspace() {
	const workspace = await invoke("get_workspace_state");
	state.hosts = workspace.hosts ?? [];
	state.selectedHostId = workspace.selectedHostId ?? null;

	const stillEditing = state.hosts.find(
		(host) => host.id === state.editingHostId,
	);
	if (!stillEditing) {
		setFormMode(null);
	}

	renderHostPanel();
	renderActiveHost();

	if (!state.selectedHostId && state.logsView.hostId) {
		closeLogsModal();
	}

	if (!state.selectedHostId && state.inspectView.hostId) {
		closeInspectModal();
	}
}

async function refreshContainers() {
	state.openContainerMenuId = null;

	if (!state.selectedHostId) {
		state.containers = [];
		renderContainers();
		return;
	}

	const containers = await invoke("list_containers", {
		hostId: state.selectedHostId,
	});
	state.containers = containers;
	renderContainers();
}

async function refreshForwards() {
	if (!state.selectedHostId) {
		state.activeForwards = [];
		renderForwards();
		return;
	}

	const forwards = await invoke("list_port_forwards", {
		hostId: state.selectedHostId,
	});
	state.activeForwards = forwards ?? [];
	renderForwards();
}

async function handleHostAction(event) {
	const target = event.target;
	if (!(target instanceof Element)) {
		return;
	}

	const button = target.closest("button[data-action][data-host-id]");
	if (
		!(button instanceof HTMLButtonElement) ||
		!elements.hostsList.contains(button)
	) {
		return;
	}

	const hostId = button.dataset.hostId;
	const action = button.dataset.action;
	if (!hostId || !action) {
		return;
	}

	const host = state.hosts.find((entry) => entry.id === hostId);
	if (!host) {
		return;
	}

	if (action === "select") {
		await invoke("select_host", { hostId });
		state.selectedHostId = hostId;
		renderHostPanel();
		renderActiveHost();
		await refreshContainers();
		await refreshForwards();
		if (state.logsView.hostId && state.logsView.hostId !== hostId) {
			closeLogsModal();
		}
		if (state.inspectView.hostId && state.inspectView.hostId !== hostId) {
			closeInspectModal();
		}
		clearNotice();
		return;
	}

	if (action === "edit") {
		setFormMode(host);
		clearNotice();
		return;
	}

	if (action === "delete") {
		const proceed = window.confirm(`Delete host \"${host.name}\"?`);
		if (!proceed) {
			return;
		}

		await invoke("remove_host", { hostId });
		if (state.editingHostId === hostId) {
			setFormMode(null);
		}

		await refreshWorkspace();
		await refreshContainers();
		await refreshForwards();
		if (state.logsView.hostId === hostId) {
			closeLogsModal();
		}
		if (state.inspectView.hostId === hostId) {
			closeInspectModal();
		}
		setNotice(`Removed ${host.name}.`);
	}
}

async function handleContainerAction(event) {
	const target = event.target;
	if (!(target instanceof Element)) {
		return;
	}

	const button = target.closest("button[data-action][data-container-id]");
	if (
		!(button instanceof HTMLButtonElement) ||
		!elements.containersBody.contains(button)
	) {
		return;
	}

	const action = button.dataset.action;
	const containerId = button.dataset.containerId;
	if (!action || !containerId || !state.selectedHostId) {
		return;
	}

	if (action === "toggle-menu") {
		state.openContainerMenuId =
			state.openContainerMenuId === containerId ? null : containerId;
		renderContainers();
		return;
	}

	const container = state.containers.find((entry) => entry.id === containerId);
	if (!container) {
		return;
	}

	if (
		action === "forward" ||
		action === "logs" ||
		action === "inspect" ||
		action === "restart"
	) {
		state.openContainerMenuId = null;
		renderContainers();
	}

	if (action === "logs") {
		try {
			await openLogsModal(container);
			clearNotice();
		} catch (error) {
			setNotice(String(error), "error");
		}
		return;
	}

	if (action === "inspect") {
		try {
			await openInspectModal(container);
			clearNotice();
		} catch (error) {
			setNotice(String(error), "error");
		}
		return;
	}

	if (action === "restart") {
		const confirmed = window.confirm(`Restart container "${container.name}"?`);
		if (!confirmed) {
			return;
		}

		beginBusy(`Restarting ${container.name}...`);
		try {
			await invoke("restart_container", {
				input: {
					hostId: state.selectedHostId,
					containerId: container.id,
				},
			});

			await refreshContainers();
			setNotice(`Container restarted: ${container.name}`);
		} catch (error) {
			setNotice(String(error), "error");
		} finally {
			endBusy();
		}
		return;
	}

	if (action !== "forward") {
		return;
	}

	try {
		const candidates = extractPortCandidates(container.ports);
		const defaultRemotePort = candidates[0] ? String(candidates[0]) : "";

		const remoteRaw = window.prompt(
			`Remote port for container \"${container.name}\"`,
			defaultRemotePort,
		);
		if (remoteRaw === null) {
			return;
		}

		const remotePort = parsePort(remoteRaw, "Remote port");

		const localRaw = window.prompt(
			`Local port for forward to \"${container.name}\"`,
			String(remotePort),
		);
		if (localRaw === null) {
			return;
		}

		const localPort = parsePort(localRaw, "Local port");

		const forward = await invoke("start_port_forward", {
			input: {
				hostId: state.selectedHostId,
				containerId: container.id,
				containerName: container.name,
				localPort,
				remotePort,
			},
		});

		await refreshForwards();
		setNotice(
			`Forward started: localhost:${forward.localPort} -> ${forward.targetHost}:${forward.targetPort}`,
		);
	} catch (error) {
		setNotice(String(error), "error");
	}
}

async function handleForwardAction(event) {
	const target = event.target;
	if (!(target instanceof Element)) {
		return;
	}

	const button = target.closest(
		"button[data-action='stop-forward'][data-forward-id]",
	);
	if (
		!(button instanceof HTMLButtonElement) ||
		!elements.forwardsList.contains(button)
	) {
		return;
	}

	const forwardId = button.dataset.forwardId;
	if (!forwardId) {
		return;
	}

	await invoke("stop_port_forward", { forwardId });
	await refreshForwards();
	setNotice("Forward stopped.");
}

async function handleFormSubmit(event) {
	event.preventDefault();

	const payload = {
		id: state.editingHostId,
		name: elements.hostName.value,
		sshTarget: elements.hostTarget.value,
		notes: elements.hostNotes.value,
	};

	const saved = await invoke("upsert_host", { input: payload });
	setNotice(
		state.editingHostId ? `Updated ${saved.name}.` : `Created ${saved.name}.`,
	);
	setFormMode(null);

	await refreshWorkspace();

	if (!state.selectedHostId) {
		await invoke("select_host", { hostId: saved.id });
		state.selectedHostId = saved.id;
	}

	await refreshWorkspace();
	await refreshContainers();
	await refreshForwards();
}

async function bootstrap() {
	renderModuleShell();
	renderDevtoolsModule();

	for (const trigger of elements.moduleTriggers) {
		trigger.addEventListener("click", () => {
			switchModule(trigger.dataset.moduleTarget);
		});
	}

	elements.hostsList.addEventListener("click", (event) => {
		handleHostAction(event).catch((error) => setNotice(String(error), "error"));
	});

	elements.hostForm.addEventListener("submit", (event) => {
		handleFormSubmit(event).catch((error) => setNotice(String(error), "error"));
	});

	elements.resetHost.addEventListener("click", () => {
		setFormMode(null);
		clearNotice();
	});

	elements.refreshContainers.addEventListener("click", () => {
		refreshContainers()
			.then(() => clearNotice())
			.catch((error) => setNotice(String(error), "error"));
	});

	elements.containerSearch.addEventListener("input", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		state.containerSearchQuery = target.value;
		renderContainers();
	});

	elements.containersBody.addEventListener("click", (event) => {
		handleContainerAction(event).catch((error) =>
			setNotice(String(error), "error"),
		);
	});

	elements.forwardsList.addEventListener("click", (event) => {
		handleForwardAction(event).catch((error) =>
			setNotice(String(error), "error"),
		);
	});

	elements.devtoolsEnvironments.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const button = target.closest("button[data-environment-id]");
		if (!(button instanceof HTMLButtonElement)) {
			return;
		}

		state.devtools.selectedEnvironmentId = button.dataset.environmentId;
		state.devtools.selectedServiceId =
			currentDevtoolsEnvironment().services[0]?.id ?? null;
		state.devtools.serviceQuery = "";
		elements.devtoolsServiceSearch.value = "";
		clearDevtoolsNotice();
		renderDevtoolsModule();
	});

	elements.devtoolsServiceSearch.addEventListener("input", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		state.devtools.serviceQuery = target.value;
		clearDevtoolsNotice();
		renderDevtoolsModule();
	});

	elements.devtoolsServices.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const button = target.closest("button[data-service-id]");
		if (!(button instanceof HTMLButtonElement)) {
			return;
		}

		state.devtools.selectedServiceId = button.dataset.serviceId;
		clearDevtoolsNotice();
		renderDevtoolsModule();
	});

	elements.devtoolsDetail.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		const button = target.closest("button[data-devtools-command]");
		if (!(button instanceof HTMLButtonElement)) {
			return;
		}

		copyToClipboard(
			button.dataset.devtoolsCommand,
			button.dataset.devtoolsLabel ?? "Command copied.",
		).catch((error) => setDevtoolsNotice(String(error), "error"));
	});

	elements.devtoolsUp.addEventListener("click", () => {
		copyToClipboard(
			elements.devtoolsUp.dataset.command,
			elements.devtoolsUp.dataset.notice ?? "Command copied.",
		).catch((error) => setDevtoolsNotice(String(error), "error"));
	});

	elements.devtoolsDown.addEventListener("click", () => {
		copyToClipboard(
			elements.devtoolsDown.dataset.command,
			elements.devtoolsDown.dataset.notice ?? "Command copied.",
		).catch((error) => setDevtoolsNotice(String(error), "error"));
	});

	elements.devtoolsLogs.addEventListener("click", () => {
		copyToClipboard(
			elements.devtoolsLogs.dataset.command,
			elements.devtoolsLogs.dataset.notice ?? "Command copied.",
		).catch((error) => setDevtoolsNotice(String(error), "error"));
	});

	elements.logsClose.addEventListener("click", () => {
		closeLogsModal();
		clearNotice();
	});

	elements.inspectClose.addEventListener("click", () => {
		closeInspectModal();
		clearNotice();
	});

	elements.inspectSearch.addEventListener("input", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}
		state.inspectView.searchQuery = target.value;
		state.inspectView.activeMatchIndex = 0;
		renderInspectOutput();
	});

	elements.inspectSearch.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			moveInspectMatch(event.shiftKey ? -1 : 1);
		}
	});

	elements.inspectSearchPrev.addEventListener("click", () => {
		moveInspectMatch(-1);
	});

	elements.inspectSearchNext.addEventListener("click", () => {
		moveInspectMatch(1);
	});

	elements.logsRefresh.addEventListener("click", () => {
		loadContainerLogs({ reset: true })
			.then(() => clearNotice())
			.catch((error) => setNotice(String(error), "error"));
	});

	elements.logsFollow.addEventListener("change", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		state.logsView.follow = target.checked;
		if (target.checked) {
			state.logsView.since = new Date().toISOString();
			startLogsPolling();
		} else {
			stopLogsPolling();
		}
	});

	elements.logsModal.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		if (target.matches("[data-action='close-logs']")) {
			closeLogsModal();
			clearNotice();
		}
	});

	elements.inspectModal.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		if (target.matches("[data-action='close-inspect']")) {
			closeInspectModal();
			clearNotice();
		}
	});

	document.addEventListener("keydown", (event) => {
		if (
			event.key === "Escape" &&
			!elements.inspectModal.classList.contains("hidden")
		) {
			closeInspectModal();
			clearNotice();
			return;
		}

		if (
			event.key === "Escape" &&
			!elements.logsModal.classList.contains("hidden")
		) {
			closeLogsModal();
			clearNotice();
			return;
		}

		if (event.key === "Escape" && state.openContainerMenuId) {
			closeContainerMenu();
		}
	});

	document.addEventListener("click", (event) => {
		if (!state.openContainerMenuId) {
			return;
		}

		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}

		if (target.closest(".table-action-menu")) {
			return;
		}

		closeContainerMenu();
	});

	try {
		await refreshWorkspace();
		await refreshContainers();
		await refreshForwards();
		renderModuleShell();
		renderDevtoolsModule();
	} catch (error) {
		setNotice(String(error), "error");
	}
}

bootstrap();

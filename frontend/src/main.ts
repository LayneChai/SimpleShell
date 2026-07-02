import './style.css';
import '@xterm/xterm/css/xterm.css';

import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {
	ConfirmHostKey,
	Connect,
	Disconnect,
	Resize,
	SelectPrivateKey,
	SendInput,
} from '../wailsjs/go/main/App';
import {EventsOn, Quit, WindowMinimise, WindowToggleMaximise} from '../wailsjs/runtime/runtime';

type ConnectionStatus = {
	sessionId: string;
	state: string;
	message: string;
};

type TerminalOutput = {
	sessionId: string;
	data: string;
};

type HostKeyPrompt = {
	id: string;
	sessionId: string;
	host: string;
	port: number;
	remote: string;
	algorithm: string;
	fingerprint: string;
};

type ShellSession = {
	id: string;
	profileId?: string;
	label: string;
	status: string;
	terminal: Terminal;
	fitAddon: FitAddon;
	element: HTMLElement;
};

type ConnectionProfile = {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	authMethod: string;
	password: string;
	privateKeyPath: string;
	privateKeyPassphrase: string;
};

type CommandSuggestion = {
	command: string;
	description: string;
	category: string;
};

const backendReady = Boolean((window as any).go?.main?.App && (window as any).runtime);
const sessions = new Map<string, ShellSession>();
const profiles: ConnectionProfile[] = [];
const profileSessionIds = new Map<string, string>();
const transparencyStorageKey = 'simpleshell.backgroundTransparency';
const profilesStorageKey = 'simpleshell.connectionProfiles';
const defaultTransparency = 100;
const commandSuggestionLimit = 6;
const commandSuggestions: CommandSuggestion[] = [
	{command: 'pwd', description: '显示当前所在目录', category: '目录'},
	{command: 'ls -la', description: '查看当前目录下的全部文件', category: '目录'},
	{command: 'cd /path/to/dir', description: '进入指定目录', category: '目录'},
	{command: 'mkdir new-folder', description: '创建新目录', category: '文件'},
	{command: 'touch file.txt', description: '创建空文件或更新时间', category: '文件'},
	{command: 'cat file.txt', description: '查看文件内容', category: '文件'},
	{command: 'tail -f app.log', description: '实时查看日志输出', category: '日志'},
	{command: 'grep -n "keyword" file.txt', description: '在文件中搜索关键词', category: '搜索'},
	{command: 'find . -name "*.log"', description: '按名称查找文件', category: '搜索'},
	{command: 'df -h', description: '查看磁盘空间', category: '系统'},
	{command: 'free -h', description: '查看内存使用情况', category: '系统'},
	{command: 'top', description: '查看正在运行的进程', category: '系统'},
	{command: 'ps aux | grep name', description: '查找指定进程', category: '进程'},
	{command: 'systemctl status service', description: '查看服务状态', category: '服务'},
	{command: 'systemctl restart service', description: '重启指定服务', category: '服务'},
	{command: 'ip addr', description: '查看服务器网络地址', category: '网络'},
	{command: 'ping example.com', description: '测试网络连通性', category: '网络'},
	{command: 'curl -I https://example.com', description: '查看 HTTP 响应头', category: '网络'},
	{command: 'scp file user@host:/path', description: '复制文件到远程服务器', category: '传输'},
	{command: 'chmod +x script.sh', description: '给脚本添加执行权限', category: '权限'},
];
let activeSessionId = '';
let editingProfileId = '';
let activeSuggestionIndex = 0;

document.querySelector('#app')!.innerHTML = `
	<div class="app-shell">
		<header class="window-titlebar">
			<div class="window-brand">
				<span>SimpleShell</span>
				<button id="settingsButton" type="button" class="title-button">透明度</button>
			</div>
			<div class="window-controls">
				<button id="minimizeWindowButton" type="button" class="window-button" title="最小化">-</button>
				<button id="maximizeWindowButton" type="button" class="window-button" title="最大化">□</button>
				<button id="closeWindowButton" type="button" class="window-button close" title="关闭">×</button>
			</div>
		</header>
		<div id="settingsMenu" class="settings-menu hidden">
			<label>
				<span>背景透明度 <strong id="transparencyValue">100%</strong></span>
				<input id="transparencyRange" type="range" min="0" max="100" step="1" value="100" />
			</label>
		</div>
		<main class="shell-layout">
		<aside class="sidebar" aria-label="连接控制">
			<div class="brand">
				<div class="brand-mark">S</div>
				<div>
					<h1>SimpleShell</h1>
					<p id="statusText">就绪</p>
				</div>
			</div>

			<section class="connections-panel" aria-label="SSH 连接">
				<button id="newConnectionButton" type="button" class="new-connection-button">新建连接</button>
				<div class="section-header">
					<span>连接列表</span>
					<strong id="connectionCount">0</strong>
				</div>
				<div id="connectionList" class="connection-list"></div>
			</section>

		</aside>

		<section class="terminal-section">
			<header class="terminal-toolbar">
				<div>
					<strong id="activeTitle">暂无连接</strong>
					<span id="activeMeta">请在左侧创建 SSH 连接。</span>
				</div>
				<button id="clearTerminalButton" type="button" class="icon-button" title="清空终端" disabled>清空</button>
			</header>
			<div id="terminalFrame" class="terminal-frame">
				<div id="terminalEmpty" class="terminal-empty">打开一个 SSH 连接后开始终端会话。</div>
				<div id="terminalStack" class="terminal-stack"></div>
			</div>
			<form id="commandForm" class="command-bar">
				<input id="commandInput" type="text" autocomplete="off" placeholder="输入命令后按回车执行" aria-autocomplete="list" aria-controls="commandSuggestions" disabled />
				<button id="sendCommandButton" type="submit" class="primary-button" disabled>运行</button>
			</form>
			<div id="commandSuggestions" class="command-suggestions hidden" role="listbox" aria-label="命令提示"></div>
			<div id="messageBar" class="message-bar" role="status" aria-live="polite"></div>
		</section>
		</main>
		<div id="connectionModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="connectionModalTitle">
			<div class="connection-modal">
				<header class="modal-header">
					<strong id="connectionModalTitle">新建连接</strong>
					<button id="closeConnectionModalButton" type="button" class="window-button" title="关闭">×</button>
				</header>
				<form id="connectionForm" class="control-stack">
					<label>
						<span>连接名称</span>
						<input id="profileName" name="profileName" type="text" autocomplete="off" placeholder="例如：生产服务器" />
					</label>

					<label>
						<span>主机</span>
						<input id="host" name="host" type="text" autocomplete="off" placeholder="服务器 IP 或域名" required />
					</label>

					<div class="field-row">
						<label>
							<span>端口</span>
							<input id="port" name="port" type="number" min="1" max="65535" value="22" required />
						</label>
						<label>
							<span>用户</span>
							<input id="username" name="username" type="text" autocomplete="username" required />
						</label>
					</div>

					<label>
						<span>认证方式</span>
						<select id="authMethod" name="authMethod">
							<option value="password">密码</option>
							<option value="key">私钥</option>
						</select>
					</label>

					<label id="passwordField">
						<span>密码</span>
						<input id="password" name="password" type="password" autocomplete="current-password" />
					</label>

					<div id="keyFields" class="key-fields hidden">
						<label>
							<span>私钥文件</span>
							<div class="path-row">
								<input id="privateKeyPath" name="privateKeyPath" type="text" autocomplete="off" />
								<button id="browseKey" type="button" class="secondary-button">选择</button>
							</div>
						</label>
						<label>
							<span>私钥密码</span>
							<input id="privateKeyPassphrase" name="privateKeyPassphrase" type="password" autocomplete="off" />
						</label>
					</div>

					<div class="action-row">
						<button id="connectButton" type="submit" class="primary-button">保存并连接</button>
					</div>
				</form>
			</div>
		</div>
	</div>
`;

const settingsButton = document.getElementById('settingsButton') as HTMLButtonElement;
const settingsMenu = document.getElementById('settingsMenu') as HTMLElement;
const transparencyRange = document.getElementById('transparencyRange') as HTMLInputElement;
const transparencyValue = document.getElementById('transparencyValue') as HTMLElement;
const minimizeWindowButton = document.getElementById('minimizeWindowButton') as HTMLButtonElement;
const maximizeWindowButton = document.getElementById('maximizeWindowButton') as HTMLButtonElement;
const closeWindowButton = document.getElementById('closeWindowButton') as HTMLButtonElement;
const newConnectionButton = document.getElementById('newConnectionButton') as HTMLButtonElement;
const connectionModal = document.getElementById('connectionModal') as HTMLElement;
const connectionModalTitle = document.getElementById('connectionModalTitle') as HTMLElement;
const closeConnectionModalButton = document.getElementById('closeConnectionModalButton') as HTMLButtonElement;
const form = document.getElementById('connectionForm') as HTMLFormElement;
const profileNameInput = document.getElementById('profileName') as HTMLInputElement;
const hostInput = document.getElementById('host') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const authMethodInput = document.getElementById('authMethod') as HTMLSelectElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const privateKeyPathInput = document.getElementById('privateKeyPath') as HTMLInputElement;
const privateKeyPassphraseInput = document.getElementById('privateKeyPassphrase') as HTMLInputElement;
const connectButton = document.getElementById('connectButton') as HTMLButtonElement;
const passwordField = document.getElementById('passwordField') as HTMLElement;
const keyFields = document.getElementById('keyFields') as HTMLElement;
const browseKeyButton = document.getElementById('browseKey') as HTMLButtonElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const connectionList = document.getElementById('connectionList') as HTMLElement;
const connectionCount = document.getElementById('connectionCount') as HTMLElement;
const terminalStack = document.getElementById('terminalStack') as HTMLElement;
const terminalEmpty = document.getElementById('terminalEmpty') as HTMLElement;
const activeTitle = document.getElementById('activeTitle') as HTMLElement;
const activeMeta = document.getElementById('activeMeta') as HTMLElement;
const clearTerminalButton = document.getElementById('clearTerminalButton') as HTMLButtonElement;
const commandForm = document.getElementById('commandForm') as HTMLFormElement;
const commandInput = document.getElementById('commandInput') as HTMLInputElement;
const sendCommandButton = document.getElementById('sendCommandButton') as HTMLButtonElement;
const commandSuggestionsElement = document.getElementById('commandSuggestions') as HTMLElement;
const messageBar = document.getElementById('messageBar') as HTMLElement;

loadTransparency();
loadProfiles();
bindEvents();
renderConnections();

function bindEvents() {
	settingsButton.addEventListener('click', (event) => {
		event.stopPropagation();
		settingsMenu.classList.toggle('hidden');
	});

	settingsMenu.addEventListener('click', (event) => event.stopPropagation());

	transparencyRange.addEventListener('input', () => {
		const value = clampTransparency(Number(transparencyRange.value));
		applyTransparency(value);
		localStorage.setItem(transparencyStorageKey, String(value));
	});

	minimizeWindowButton.addEventListener('click', () => {
		if (backendReady) {
			WindowMinimise();
		}
	});

	maximizeWindowButton.addEventListener('click', () => {
		if (backendReady) {
			WindowToggleMaximise();
		}
	});

	closeWindowButton.addEventListener('click', () => {
		if (backendReady) {
			Quit();
		} else {
			window.close();
		}
	});

	document.addEventListener('click', () => settingsMenu.classList.add('hidden'));
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			settingsMenu.classList.add('hidden');
			closeConnectionModal();
		}
	});

	newConnectionButton.addEventListener('click', () => openConnectionModal());
	closeConnectionModalButton.addEventListener('click', closeConnectionModal);
	connectionModal.addEventListener('click', (event) => {
		if (event.target === connectionModal) {
			closeConnectionModal();
		}
	});

	form.addEventListener('submit', (event) => {
		event.preventDefault();
		void connect();
	});

	clearTerminalButton.addEventListener('click', () => {
		activeSession()?.terminal.clear();
	});

	commandForm.addEventListener('submit', (event) => {
		event.preventDefault();
		void sendCommandLine();
	});
	commandInput.addEventListener('input', () => {
		activeSuggestionIndex = 0;
		renderCommandSuggestions();
	});
	commandInput.addEventListener('focus', renderCommandSuggestions);
	commandInput.addEventListener('blur', () => {
		window.setTimeout(hideCommandSuggestions, 120);
	});
	commandInput.addEventListener('keydown', (event) => {
		const suggestions = matchingCommandSuggestions();
		const hasVisibleSuggestions = commandSuggestionsElement.dataset.visible === 'true' && suggestions.length > 0;

		if (hasVisibleSuggestions && event.key === 'ArrowDown') {
			event.preventDefault();
			activeSuggestionIndex = (activeSuggestionIndex + 1) % suggestions.length;
			renderCommandSuggestions();
			return;
		}
		if (hasVisibleSuggestions && event.key === 'ArrowUp') {
			event.preventDefault();
			activeSuggestionIndex = (activeSuggestionIndex - 1 + suggestions.length) % suggestions.length;
			renderCommandSuggestions();
			return;
		}
		if (hasVisibleSuggestions && event.key === 'Tab') {
			event.preventDefault();
			applyCommandSuggestion(suggestions[activeSuggestionIndex]);
			return;
		}
		if (event.key === 'Escape') {
			hideCommandSuggestions();
			return;
		}
		if (event.key !== 'Enter') {
			return;
		}
		if (hasVisibleSuggestions) {
			event.preventDefault();
			applyCommandSuggestion(suggestions[activeSuggestionIndex]);
			return;
		}
		event.preventDefault();
		void sendCommandLine();
	});

	authMethodInput.addEventListener('change', syncAuthFields);

	browseKeyButton.addEventListener('click', async () => {
		if (!backendReady) {
			showError('文件选择功能需要在桌面应用中使用。');
			return;
		}
		const selected = await SelectPrivateKey();
		if (selected) {
			privateKeyPathInput.value = selected;
		}
	});

	window.addEventListener('resize', queueFitActive);

	if (backendReady) {
		EventsOn('ssh:output', (payload: TerminalOutput) => writeOutput(payload));
		EventsOn('ssh:error', (payload: TerminalOutput | string) => {
			if (typeof payload === 'string') {
				showError(payload);
			} else {
				showError(payload.data, payload.sessionId);
			}
		});
		EventsOn('ssh:status', (status: ConnectionStatus) => setStatus(status));
		EventsOn('ssh:hostkey-confirm', (prompt: HostKeyPrompt) => {
			void confirmHostKey(prompt);
		});
	}

	syncAuthFields();
}

function loadTransparency() {
	const stored = Number(localStorage.getItem(transparencyStorageKey));
	const value = Number.isFinite(stored) ? clampTransparency(stored) : defaultTransparency;
	transparencyRange.value = String(value);
	applyTransparency(value);
}

function clampTransparency(value: number) {
	return Math.min(100, Math.max(0, Math.round(value)));
}

function applyTransparency(transparency: number) {
	const backgroundAlpha = (100 - transparency) / 100;

	document.documentElement.style.setProperty('--background-alpha', backgroundAlpha.toFixed(3));
	transparencyValue.textContent = `${transparency}%`;
}

function loadProfiles() {
	try {
		const raw = localStorage.getItem(profilesStorageKey);
		if (!raw) {
			return;
		}
		const parsed = JSON.parse(raw) as Partial<ConnectionProfile>[];
		if (!Array.isArray(parsed)) {
			return;
		}
		profiles.splice(0, profiles.length, ...parsed
			.filter((profile) => profile.id && profile.host && profile.username)
			.map((profile) => ({
				id: String(profile.id),
				name: String(profile.name || ''),
				host: String(profile.host),
				port: Number(profile.port || 22),
				username: String(profile.username),
				authMethod: profile.authMethod === 'key' ? 'key' : 'password',
				password: String(profile.password || ''),
				privateKeyPath: String(profile.privateKeyPath || ''),
				privateKeyPassphrase: String(profile.privateKeyPassphrase || ''),
			})));
	} catch {
		profiles.splice(0, profiles.length);
	}
}

function saveProfiles() {
	localStorage.setItem(profilesStorageKey, JSON.stringify(profiles));
}

function openConnectionModal(profileId = '') {
	const profile = profiles.find((item) => item.id === profileId);

	editingProfileId = profile?.id || '';
	connectionModalTitle.textContent = profile ? '编辑连接' : '新建连接';
	profileNameInput.value = profile?.name || '';
	hostInput.value = profile?.host || '';
	portInput.value = String(profile?.port || 22);
	usernameInput.value = profile?.username || '';
	authMethodInput.value = profile?.authMethod || 'password';
	passwordInput.value = profile?.password || '';
	privateKeyPathInput.value = profile?.privateKeyPath || '';
	privateKeyPassphraseInput.value = profile?.privateKeyPassphrase || '';
	connectButton.textContent = '保存并连接';
	messageBar.textContent = '';
	syncAuthFields();
	updateActiveChrome();
	connectionModal.classList.remove('hidden');
	window.setTimeout(() => hostInput.focus(), 20);
}

function closeConnectionModal() {
	connectionModal.classList.add('hidden');
	editingProfileId = '';
}

function readProfileFromForm(): ConnectionProfile {
	const host = hostInput.value.trim();
	const username = usernameInput.value.trim();
	const port = Number(portInput.value || '22');
	const name = profileNameInput.value.trim();

	return {
		id: editingProfileId || createProfileId(),
		name,
		host,
		port,
		username,
		authMethod: authMethodInput.value === 'key' ? 'key' : 'password',
		password: passwordInput.value,
		privateKeyPath: privateKeyPathInput.value.trim(),
		privateKeyPassphrase: privateKeyPassphraseInput.value,
	};
}

function upsertProfile(profile: ConnectionProfile) {
	const index = profiles.findIndex((item) => item.id === profile.id);
	if (index >= 0) {
		profiles[index] = profile;
	} else {
		profiles.unshift(profile);
	}
	saveProfiles();
	renderConnections();
}

function profileLabel(profile: ConnectionProfile) {
	return profile.name || `${profile.username}@${profile.host}:${profile.port || 22}`;
}

function shortLabel(label: string) {
	const chars = Array.from(label);
	return chars.length > 9 ? `${chars.slice(0, 9).join('')}...` : label;
}

function profileMeta(profile: ConnectionProfile) {
	return `${profile.username}@${profile.host}:${profile.port || 22}`;
}

async function connect() {
	const profile = readProfileFromForm();

	upsertProfile(profile);
	closeConnectionModal();
	await connectProfile(profile.id, true);
}

async function connectProfile(profileId: string, forceReconnect = false) {
	const profile = profiles.find((item) => item.id === profileId);
	if (!profile) {
		return;
	}

	const existingSessionId = profileSessionIds.get(profile.id);
	const existingSession = existingSessionId ? sessions.get(existingSessionId) : undefined;
	if (existingSession && !forceReconnect && existingSession.status !== 'Disconnected' && existingSession.status !== 'Error') {
		setActiveSession(existingSession.id);
		return;
	}
	if (existingSession && forceReconnect) {
		if (backendReady && existingSession.status === 'Connected') {
			await Disconnect(existingSession.id).catch((error) => showError(error, existingSession.id));
		}
		existingSession.element.remove();
		sessions.delete(existingSession.id);
		profileSessionIds.delete(profile.id);
		if (activeSessionId === existingSession.id) {
			activeSessionId = '';
		}
	}

	if (profile.authMethod === 'password' && !profile.password) {
		openConnectionModal(profile.id);
		showError('请输入密码后再连接。');
		return;
	}
	if (profile.authMethod === 'key' && !profile.privateKeyPath) {
		openConnectionModal(profile.id);
		showError('请选择私钥文件后再连接。');
		return;
	}

	const sessionId = createSessionId();
	const label = profileLabel(profile);
	const shell = createTerminalSession(sessionId, label, 'Connecting', profile.id);
	profileSessionIds.set(profile.id, sessionId);
	setActiveSession(sessionId);
	setConnectBusy(true);
	messageBar.textContent = '';

	const options = {
		sessionId,
		host: profile.host,
		port: Number(profile.port || '22'),
		username: profile.username,
		authMethod: profile.authMethod,
		password: profile.password,
		privateKeyPath: profile.privateKeyPath,
		privateKeyPassphrase: profile.privateKeyPassphrase,
	};

	try {
		if (backendReady) {
			await Connect(options);
		} else {
			await new Promise((resolve) => window.setTimeout(resolve, 250));
			shell.terminal.write('\x1b[38;5;110m预览模式：当前未连接桌面后端。\x1b[0m\r\n');
			setStatus({sessionId, state: 'Connected', message: `预览连接：${label}`});
		}
	} catch (error) {
		shell.status = 'Error';
		showError(error, sessionId);
		setStatus({sessionId, state: 'Error', message: String(error)});
	} finally {
		setConnectBusy(false);
		renderConnections();
	}
}

async function sendCommandLine() {
	const shell = activeSession();
	const command = commandInput.value;
	if (!shell || !command.trim()) {
		return;
	}
	commandInput.value = '';
	hideCommandSuggestions();

	if (backendReady && shell.status === 'Connected') {
		await SendInput(shell.id, `${command}\r`).catch((error) => showError(error, shell.id));
	} else {
		shell.terminal.write(`\r\n$ ${command}\r\n`);
	}
}

function matchingCommandSuggestions() {
	if (commandInput.disabled) {
		return [];
	}

	const query = commandInput.value.trim().toLowerCase();
	if (!query) {
		return commandSuggestions.slice(0, commandSuggestionLimit);
	}

	return commandSuggestions
		.filter((suggestion) => {
			const searchable = `${suggestion.command} ${suggestion.description} ${suggestion.category}`.toLowerCase();
			return searchable.includes(query);
		})
		.slice(0, commandSuggestionLimit);
}

function renderCommandSuggestions() {
	const suggestions = matchingCommandSuggestions();
	if (suggestions.length === 0 || document.activeElement !== commandInput) {
		hideCommandSuggestions();
		return;
	}

	activeSuggestionIndex = Math.min(activeSuggestionIndex, suggestions.length - 1);
	commandSuggestionsElement.dataset.visible = 'true';
	commandSuggestionsElement.classList.remove('hidden');
	commandSuggestionsElement.innerHTML = suggestions.map((suggestion, index) => `
		<button
			type="button"
			class="command-suggestion ${index === activeSuggestionIndex ? 'active' : ''}"
			data-index="${index}"
			role="option"
			aria-selected="${index === activeSuggestionIndex}"
		>
			<span class="command-suggestion-main">${highlightCommandMatch(suggestion.command)}</span>
			<span class="command-suggestion-meta">
				<strong>${escapeHtml(suggestion.category)}</strong>
				${escapeHtml(suggestion.description)}
			</span>
		</button>
	`).join('');

	commandSuggestionsElement.querySelectorAll<HTMLButtonElement>('.command-suggestion').forEach((button) => {
		button.addEventListener('mouseenter', () => {
			activeSuggestionIndex = Number(button.dataset.index || '0');
			renderCommandSuggestions();
		});
		button.addEventListener('mousedown', (event) => {
			event.preventDefault();
			applyCommandSuggestion(suggestions[Number(button.dataset.index || '0')]);
		});
	});
}

function hideCommandSuggestions() {
	commandSuggestionsElement.dataset.visible = 'false';
	commandSuggestionsElement.classList.add('hidden');
	commandSuggestionsElement.innerHTML = '';
}

function applyCommandSuggestion(suggestion: CommandSuggestion | undefined) {
	if (!suggestion) {
		return;
	}

	commandInput.value = suggestion.command;
	hideCommandSuggestions();
	commandInput.focus();
	commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
}

function highlightCommandMatch(command: string) {
	const query = commandInput.value.trim();
	if (!query) {
		return escapeHtml(command);
	}

	const index = command.toLowerCase().indexOf(query.toLowerCase());
	if (index < 0) {
		return escapeHtml(command);
	}

	const before = command.slice(0, index);
	const match = command.slice(index, index + query.length);
	const after = command.slice(index + query.length);
	return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

async function confirmHostKey(prompt: HostKeyPrompt) {
	const accepted = window.confirm(
		`是否信任 ${prompt.host}:${prompt.port} 的 SSH 主机密钥？\n\n` +
		`算法：${prompt.algorithm}\n` +
		`指纹：${prompt.fingerprint}`
	);

	try {
		await ConfirmHostKey(prompt.id, accepted);
	} catch (error) {
		showError(error, prompt.sessionId);
	}
}

function createTerminalSession(id: string, label: string, status: string, profileId = '') {
	const terminalElement = document.createElement('div');
	terminalElement.className = 'terminal-pane';
	terminalElement.dataset.sessionId = id;

	const terminalHost = document.createElement('div');
	terminalHost.className = 'terminal-host';
	terminalElement.appendChild(terminalHost);
	terminalStack.appendChild(terminalElement);

	const fitAddon = new FitAddon();
	const terminal = new Terminal({
		allowTransparency: true,
		cursorBlink: true,
		convertEol: true,
		fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
		fontSize: 13,
		lineHeight: 1.15,
		scrollback: 10000,
		theme: terminalTheme(),
	});

	terminal.loadAddon(fitAddon);
	terminal.open(terminalHost);
	terminal.write(`\x1b[38;5;25m${label}\x1b[0m\r\n`);
	terminal.onData((data) => {
		if (backendReady && sessions.get(id)?.status === 'Connected') {
			SendInput(id, data).catch((error) => showError(error, id));
		}
	});

	const shell = {id, profileId, label, status, terminal, fitAddon, element: terminalElement};
	sessions.set(id, shell);
	renderConnections();
	window.setTimeout(() => fitSession(shell), 30);
	return shell;
}

function setActiveSession(id: string) {
	activeSessionId = id;
	for (const shell of sessions.values()) {
		shell.element.classList.toggle('active', shell.id === id);
	}
	renderConnections();
	updateActiveChrome();
	queueFitActive();
}

function activeSession() {
	return sessions.get(activeSessionId);
}

function setStatus(status: ConnectionStatus) {
	const shell = sessions.get(status.sessionId);
	if (!shell) {
		return;
	}

	shell.status = status.state;
	statusText.textContent = localizedStatusMessage(status, shell.label);
	statusText.title = `${shell.label} · ${localizedStatus(shell.status)}`;
	statusText.dataset.state = status.state;

	if (status.state === 'Disconnected') {
		shell.terminal.write('\r\n\x1b[38;5;245m已断开连接。\x1b[0m\r\n');
	}

	if (activeSessionId === shell.id) {
		updateActiveChrome();
		queueFitActive();
	}

	renderConnections();
}

function writeOutput(payload: TerminalOutput) {
	const shell = sessions.get(payload.sessionId);
	if (!shell) {
		return;
	}
	shell.terminal.write(payload.data);
}

function showError(error: unknown, sessionId = activeSessionId) {
	const message = localizedError(error instanceof Error ? error.message : String(error));
	messageBar.textContent = message;
	const shell = sessions.get(sessionId);
	if (shell) {
		shell.terminal.write(`\r\n\x1b[38;5;203m${message}\x1b[0m\r\n`);
	}
}

function terminalTheme() {
	return {
		background: 'rgba(0, 0, 0, 0)',
		foreground: '#17272f',
		cursor: '#b98112',
		selectionBackground: 'rgba(38, 113, 124, 0.28)',
		black: '#17272f',
		red: '#9f2838',
		green: '#12683d',
		yellow: '#8a5a00',
		blue: '#1557a8',
		magenta: '#7c3ea1',
		cyan: '#087281',
		white: '#17272f',
		brightBlack: '#52656d',
		brightRed: '#be3448',
		brightGreen: '#16824a',
		brightYellow: '#a86d00',
		brightBlue: '#2368c4',
		brightMagenta: '#914fb7',
		brightCyan: '#0a8998',
		brightWhite: '#0e1f27',
	};
}

function renderConnections() {
	connectionCount.textContent = String(profiles.length);
	if (profiles.length === 0) {
		connectionList.innerHTML = '<div class="empty-list">暂无连接，点击上方新建连接。</div>';
		updateActiveChrome();
		return;
	}

	connectionList.innerHTML = profiles.map((profile) => {
		const shell = sessions.get(profileSessionIds.get(profile.id) || '');
		const isActive = Boolean(shell && shell.id === activeSessionId);
		const status = shell?.status || 'Disconnected';
		return `
		<div class="connection-item ${isActive ? 'active' : ''}" data-profile-id="${profile.id}">
			<button type="button" class="connection-main" data-action="connect" data-profile-id="${profile.id}">
				<span title="${escapeHtml(profileLabel(profile))}">${escapeHtml(shortLabel(profileLabel(profile)))}</span>
				<small>${escapeHtml(profileMeta(profile))}</small>
			</button>
			<strong data-state="${status}">${localizedStatus(status)}</strong>
			<div class="connection-actions">
				<button type="button" class="mini-button" data-action="edit" data-profile-id="${profile.id}">编辑</button>
				<button type="button" class="mini-button danger" data-action="delete" data-profile-id="${profile.id}">删除</button>
			</div>
		</div>`;
	}).join('');

	connectionList.querySelectorAll<HTMLButtonElement>('[data-action="connect"]').forEach((button) => {
		button.addEventListener('click', () => {
			void connectProfile(button.dataset.profileId || '');
		});
	});
	connectionList.querySelectorAll<HTMLButtonElement>('[data-action="edit"]').forEach((button) => {
		button.addEventListener('click', () => openConnectionModal(button.dataset.profileId || ''));
	});
	connectionList.querySelectorAll<HTMLButtonElement>('[data-action="delete"]').forEach((button) => {
		button.addEventListener('click', () => {
			void deleteProfile(button.dataset.profileId || '');
		});
	});

	updateActiveChrome();
}

async function deleteProfile(profileId: string) {
	const profile = profiles.find((item) => item.id === profileId);
	if (!profile) {
		return;
	}
	if (!window.confirm(`确认删除连接“${profileLabel(profile)}”？`)) {
		return;
	}

	const sessionId = profileSessionIds.get(profileId);
	const shell = sessionId ? sessions.get(sessionId) : undefined;
	if (shell) {
		if (backendReady && shell.status === 'Connected') {
			await Disconnect(shell.id).catch((error) => showError(error, shell.id));
		}
		shell.element.remove();
		sessions.delete(shell.id);
		if (activeSessionId === shell.id) {
			activeSessionId = sessions.values().next().value?.id || '';
		}
	}

	profileSessionIds.delete(profileId);
	const index = profiles.findIndex((item) => item.id === profileId);
	if (index >= 0) {
		profiles.splice(index, 1);
		saveProfiles();
	}
	renderConnections();
	if (activeSessionId) {
		setActiveSession(activeSessionId);
	} else {
		updateActiveChrome();
	}
}

function updateActiveChrome() {
	const shell = activeSession();
	const hasActive = Boolean(shell);
	terminalEmpty.classList.toggle('hidden', sessions.size > 0);
	activeTitle.textContent = shell ? shortLabel(shell.label) : '暂无连接';
	activeTitle.title = shell?.label || '';
	activeMeta.textContent = shell ? localizedStatus(shell.status) : '请在左侧创建 SSH 连接。';
	clearTerminalButton.disabled = !hasActive;
	commandInput.disabled = !hasActive;
	sendCommandButton.disabled = !hasActive;
	if (!hasActive) {
		hideCommandSuggestions();
	}
	if (shell) {
		statusText.textContent = `${shortLabel(shell.label)} · ${localizedStatus(shell.status)}`;
		statusText.title = `${shell.label} · ${localizedStatus(shell.status)}`;
		statusText.dataset.state = shell.status;
	}
}

function setConnectBusy(isBusy: boolean) {
	connectButton.disabled = isBusy;
	connectButton.textContent = isBusy ? '连接中' : '保存并连接';
}

function localizedStatus(state: string) {
	switch (state) {
		case 'Connecting':
			return '连接中';
		case 'Connected':
			return '已连接';
		case 'Disconnected':
			return '已断开';
		case 'Error':
			return '错误';
		default:
			return state || '未知';
	}
}

function localizedStatusMessage(status: ConnectionStatus, label: string) {
	const displayLabel = shortLabel(label);
	switch (status.state) {
		case 'Connecting':
			return `正在连接 ${displayLabel}`;
		case 'Connected':
			return `${displayLabel} · 已连接`;
		case 'Disconnected':
			return `${displayLabel} · 已断开`;
		case 'Error':
			return `连接错误：${status.message || label}`;
		default:
			return status.message || localizedStatus(status.state);
	}
}

function localizedError(message: string) {
	const lower = message.toLowerCase();
	if (lower.includes('host is required')) {
		return '请输入主机地址。';
	}
	if (lower.includes('port must be')) {
		return '端口必须在 1 到 65535 之间。';
	}
	if (lower.includes('username is required')) {
		return '请输入用户名。';
	}
	if (lower.includes('password is required')) {
		return '请输入密码。';
	}
	if (lower.includes('private key path is required')) {
		return '请选择私钥文件。';
	}
	if (lower.includes('no active ssh session')) {
		return '当前没有可用的 SSH 连接。';
	}
	if (lower.includes('host key changed')) {
		return '服务器主机密钥已变化，为安全起见已阻止连接。';
	}
	if (lower.includes('ssh connection failed')) {
		return `SSH 连接失败：${message}`;
	}
	return message;
}

function syncAuthFields() {
	const usesKey = authMethodInput.value === 'key';
	passwordField.classList.toggle('hidden', usesKey);
	keyFields.classList.toggle('hidden', !usesKey);
}

function queueFitActive() {
	window.setTimeout(() => {
		const shell = activeSession();
		if (!shell) {
			return;
		}
		fitSession(shell);
		if (backendReady) {
			void Resize(shell.id, shell.terminal.cols, shell.terminal.rows).catch((error) => showError(error, shell.id));
		}
	}, 20);
}

function fitSession(shell: ShellSession) {
	shell.fitAddon.fit();
}

function createSessionId() {
	if (crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `session-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function createProfileId() {
	if (crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `profile-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

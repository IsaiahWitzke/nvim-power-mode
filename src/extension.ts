import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { attach, NeovimClient, findNvim } from 'neovim';

let nvimClient: NeovimClient | null = null;
let nvimProcess: ChildProcess | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	console.log('nvim-power-mode is now active!');

	outputChannel = vscode.window.createOutputChannel('Neovim Events');
	context.subscriptions.push(outputChannel);

	// Command to manually start neovim client
	const startCommand = vscode.commands.registerCommand('nvim-power-mode.start', async () => {
		if (nvimClient) {
			vscode.window.showInformationMessage('Neovim client already running!');
			return;
		}
		try {
			await startNeovimClient();
			vscode.window.showInformationMessage('Neovim client started!');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to start neovim: ${error}`);
		}
	});

	// Command to stop neovim client
	const stopCommand = vscode.commands.registerCommand('nvim-power-mode.stop', () => {
		stopNeovimClient();
		vscode.window.showInformationMessage('Neovim client stopped!');
	});

	// Original hello world command
	const helloCommand = vscode.commands.registerCommand('nvim-power-mode.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from nvim-power-mode!');
	});

	context.subscriptions.push(startCommand, stopCommand, helloCommand);

	// Auto-start neovim client
	startNeovimClient().catch(err => {
		console.error('Failed to auto-start neovim:', err);
	});
}

async function startNeovimClient() {
	// Try to find nvim
	const nvimResult = findNvim({ minVersion: '0.5.0' });
	const matched = nvimResult.matches.find(match => !match.error);
	
	if (!matched) {
		throw new Error('Unable to find neovim executable. Please install neovim.');
	}

	outputChannel.appendLine(`Starting neovim at: ${matched.path}`);

	// Spawn neovim in embedded mode
	nvimProcess = spawn(matched.path, ['--embed', '--headless']);

	if (!nvimProcess.stdout || !nvimProcess.stdin) {
		throw new Error('Failed to create neovim process streams');
	}

	// Attach to the neovim process
	nvimClient = attach({ proc: nvimProcess });

	// Listen for notifications from neovim
	nvimClient.on('notification', (method: string, args: any[]) => {
		const message = `Hello World! Event: ${method}`;
		outputChannel.appendLine(message);
		outputChannel.appendLine(`Args: ${JSON.stringify(args)}`);
		outputChannel.show(true);
	});

	// Listen for redraw events specifically
	nvimClient.on('request', (method: string, args: any[]) => {
		const message = `Hello World! Request: ${method}`;
		outputChannel.appendLine(message);
		outputChannel.appendLine(`Args: ${JSON.stringify(args)}`);
	});

	nvimProcess.on('error', (err) => {
		outputChannel.appendLine(`Neovim process error: ${err.message}`);
		stopNeovimClient();
	});

	nvimProcess.on('exit', (code) => {
		outputChannel.appendLine(`Neovim process exited with code: ${code}`);
		stopNeovimClient();
	});

	// Attach UI to start receiving events
	await nvimClient.uiAttach(80, 24, {
		rgb: true,
		ext_linegrid: true,
	});

	outputChannel.appendLine('Neovim client attached and listening for events!');
}

function stopNeovimClient() {
	if (nvimClient) {
		nvimClient.quit();
		nvimClient = null;
	}
	if (nvimProcess) {
		nvimProcess.kill();
		nvimProcess = null;
	}
	outputChannel.appendLine('Neovim client stopped.');
}

export function deactivate() {
	stopNeovimClient();
}

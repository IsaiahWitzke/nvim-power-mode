import * as vscode from 'vscode';
import { ComboTracker } from './combo/combo-tracker';
import { NeovimClientManager, AutocmdHandler } from './nvim/neovim-client';

const COMBO_TIMEOUT = 5; // seconds
const POWERMODE_THRESHOLD = 10;

let neovimClientManager: NeovimClientManager | null = null;
let comboTracker: ComboTracker | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Neovim power mode events');
	context.subscriptions.push(outputChannel);

	comboTracker = new ComboTracker({
		comboTimeout: COMBO_TIMEOUT,
		powermodeThreshold: POWERMODE_THRESHOLD,
		outputChannel,
	});

	const autocmdHandlers: AutocmdHandler[] = [
		{
			event: 'TextChangedI',
			handler: (_data) => {
				outputChannel.appendLine(`Insert mode text change`);
				comboTracker?.handleTextChange();
			},
		},
		{
			event: 'TextChanged',
			handler: (_data) => {
				outputChannel.appendLine(`Normal mode text change (includes undo/redo)`);
				comboTracker?.handleTextChange();
			},
		},
		{
			event: 'ModeChanged',
			handler: (data) => {
				outputChannel.appendLine(`Mode changed to: ${data.mode}`);
			},
			luaCallback: 'local mode = vim.fn.mode()\nreturn { mode = mode }',
		},
	];

	neovimClientManager = new NeovimClientManager(outputChannel, autocmdHandlers);
	neovimClientManager.connect()
		.catch(error => {
			outputChannel.appendLine(`Could not connect to existing Neovim client: ${error}`);
			vscode.window.showErrorMessage('Failed to connect to vscode-neovim. Make sure the extension is running.');
		});
}

export function deactivate() {
	comboTracker?.dispose();
	comboTracker = null;
	neovimClientManager?.dispose();
	neovimClientManager = null;
}


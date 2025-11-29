import * as vscode from 'vscode';
import { ComboTracker } from './combo/combo-tracker';
import { NeovimClientManager } from './nvim/neovim-client';
import { NeovimPlugin } from './nvim/plugin';

const COMBO_TIMEOUT = 5; // seconds
const POWERMODE_THRESHOLD = 10;

let neovimClientManager: NeovimClientManager | null = null;
let plugins: NeovimPlugin[] = [];
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Neovim power mode events');
	context.subscriptions.push(outputChannel);

	// Initialize plugins
	plugins = [
		new ComboTracker({
			comboTimeout: COMBO_TIMEOUT,
			powermodeThreshold: POWERMODE_THRESHOLD,
			outputChannel,
		}),
	];

	// Collect all autocmd handlers from plugins
	const autocmdHandlers = plugins.flatMap(plugin => [...plugin.getAutocmdHandlers()]);

	neovimClientManager = new NeovimClientManager(outputChannel, autocmdHandlers);
	neovimClientManager.connect()
		.catch(error => {
			outputChannel.appendLine(`Could not connect to existing Neovim client: ${error}`);
			vscode.window.showErrorMessage('Failed to connect to vscode-neovim. Make sure the extension is running.');
		});
}

export function deactivate() {
	for (const plugin of plugins) {
		plugin.dispose();
	}
	plugins = [];
	neovimClientManager?.dispose();
	neovimClientManager = null;
}


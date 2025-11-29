import * as vscode from 'vscode';
import { ComboTracker } from './combo/combo-tracker';
import { RidiculousTracker } from './ridiculous/ridiculous-tracker';
import { NeovimClientManager } from './nvim/neovim-client';
import { NeovimPlugin } from './nvim/plugin';

let neovimClientManager: NeovimClientManager | null = null;
let plugins: NeovimPlugin[] = [];
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Neovim power mode events');
	context.subscriptions.push(outputChannel);

	// Initialize plugins
	plugins = [
		new ComboTracker({
			comboTimeout: 5,  // seconds
			powermodeThreshold: 10,
			outputChannel,
		}),
		new RidiculousTracker(context),
	];

	// Collect all autocmd handlers from plugins
	const autocmdHandlers = plugins.flatMap(plugin => [...plugin.getAutocmdHandlers()]);

	neovimClientManager = new NeovimClientManager(outputChannel, autocmdHandlers);
	neovimClientManager.connect()
		.catch(error => {
			console.error('[nvim-power-mode] Could not connect to existing Neovim client:', error);
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


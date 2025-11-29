import * as vscode from 'vscode';
import { NeovimClient } from 'neovim';

let nvimClient: NeovimClient | null = null;
let outputChannel: vscode.OutputChannel;

interface AutocmdHandler {
	event: string;
	handler: (data: any) => void;
	luaCallback?: string;
}

const AUTOCMD_HANDLERS: AutocmdHandler[] = [
	{
		event: 'TextChangedI',
		handler: (data) => {
			outputChannel.appendLine(`Insert mode text change`);
		},
	},
	{
		event: 'TextChanged',
		handler: (data) => {
			outputChannel.appendLine(`Normal mode text change (includes undo/redo)`);
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

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Neovim power mode events');
	context.subscriptions.push(outputChannel);

	getExistingNeovimClient()
		.then(client => {
			nvimClient = client;
			setupNeovimEventListeners(client);
			vscode.window.showInformationMessage('Connected to vscode-neovim!');
		})
		.catch(error => {
			outputChannel.appendLine(`Could not connect to existing Neovim client: ${error}`);
			vscode.window.showErrorMessage('Failed to connect to vscode-neovim. Make sure the extension is running.');
		});
}

async function getExistingNeovimClient(): Promise<NeovimClient> {
	const maxRetries = 10;
	const retryDelay = 1000; // 1 second

	for (let i = 0; i < maxRetries; i++) {
		try {
			outputChannel.appendLine(`Attempting to get Neovim client from vscode-neovim extension... (attempt ${i + 1}/${maxRetries})`);
			const client = await vscode.commands.executeCommand('_getNeovimClient');
			if (client) {
				outputChannel.appendLine('Successfully obtained client from vscode-neovim extension!');
				return client as NeovimClient;
			}
		} catch (error) {
			outputChannel.appendLine(`Attempt ${i + 1} failed: ${error}`);
		}

		if (i < maxRetries - 1) {
			outputChannel.appendLine(`Waiting ${retryDelay}ms before retry...`);
			await new Promise(resolve => setTimeout(resolve, retryDelay));
		}
	}

	throw new Error('Could not get client from vscode-neovim after multiple retries. Make sure the extension is installed and enabled.');
}

export function deactivate() {
	if (nvimClient) {
		nvimClient.removeAllListeners();
		nvimClient = null;
	}
}
async function setupNeovimEventListeners(client: NeovimClient) {
	try {
		const channelId = await client.channelId;
		
		// Generate Lua code to register all autocmds
		const autocmdSetup = AUTOCMD_HANDLERS.map((handler) => {
			const luaCallback = handler.luaCallback || 'return {}';
			return `
				vim.api.nvim_create_autocmd('${handler.event}', {
					group = group,
					callback = function()
						local data = (function()
							${luaCallback}
						end)()
						vim.rpcnotify(channel, 'power-mode', { event = '${handler.event}', data = data })
					end
				})`;
		}).join('\n');
		
		await client.lua(`
			local channel = ${channelId}
			local group = vim.api.nvim_create_augroup('PowerMode', { clear = true })
			${autocmdSetup}
		`);
		
		outputChannel.appendLine(`Registered ${AUTOCMD_HANDLERS.length} autocmds successfully`);
	} catch (error) {
		outputChannel.appendLine(`Failed to set up autocmds: ${error}`);
	}

	// Set up notification handler that dispatches to registered handlers
	const handlerMap = new Map(AUTOCMD_HANDLERS.map(h => [h.event, h.handler]));
	
	client.on('notification', (method: string, args: any[]) => {
		if (method === 'power-mode') {
			const [payload] = args;
			const { event, data } = payload;
			
			const handler = handlerMap.get(event);
			if (handler) {
				handler(data);
			} else {
				outputChannel.appendLine(`No handler for event: ${event}`);
			}
			return;
		}
		
		// Log other non-redraw events for debugging
		if (method !== 'redraw') {
			outputChannel.appendLine(`Neovim Event: ${method}`);
		}
	});
}


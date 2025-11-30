import * as vscode from 'vscode';
import { NeovimClient } from 'neovim';

export interface AutocmdHandler {
	event: string;
	handler: (data: any) => void;
	luaCallback?: string;
}

export class NeovimClientManager {
	private client: NeovimClient | null = null;
	private readonly outputChannel: vscode.OutputChannel;
	private readonly autocmdHandlers: AutocmdHandler[];

	constructor(outputChannel: vscode.OutputChannel, handlers: AutocmdHandler[]) {
		this.outputChannel = outputChannel;
		this.autocmdHandlers = handlers;
	}

	async connect(): Promise<void> {
		this.client = await this.getExistingNeovimClient();
		await this.setupEventListeners();
		vscode.window.showInformationMessage('Connected to vscode-neovim!');
	}

	private async getExistingNeovimClient(): Promise<NeovimClient> {
		const maxRetries = 10;
		const retryDelay = 1000; // 1 second

		for (let i = 0; i < maxRetries; i++) {
			try {
				this.outputChannel.appendLine(`Attempting to get Neovim client from vscode-neovim extension... (attempt ${i + 1}/${maxRetries})`);
				const client = await vscode.commands.executeCommand('_getNeovimClient');
				if (client) {
					this.outputChannel.appendLine('Successfully obtained client from vscode-neovim extension!');
					return client as NeovimClient;
				}
			} catch (error) {
				this.outputChannel.appendLine(`Attempt ${i + 1} failed: ${error}`);
			}

			if (i < maxRetries - 1) {
				this.outputChannel.appendLine(`Waiting ${retryDelay}ms before retry...`);
				await new Promise(resolve => setTimeout(resolve, retryDelay));
			}
		}

		throw new Error('Could not get client from vscode-neovim after multiple retries. Make sure the extension is installed and enabled.');
	}

	private async setupEventListeners(): Promise<void> {
		const client = this.client;
		if (!client) {
			throw new Error('No client available');
		}

		try {
			const channelId = await client.channelId;
			
			// Generate Lua code to register all autocmds
			const autocmdSetup = this.autocmdHandlers.map((handler) => {
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
			
			this.outputChannel.appendLine(`Registered ${this.autocmdHandlers.length} autocmds successfully`);
		} catch (error) {
			this.outputChannel.appendLine(`Failed to set up autocmds: ${error}`);
			throw error;
		}

		// Set up notification handler that dispatches to registered handlers
		// Build a map of event -> array of handlers to support multiple handlers per event
		const handlerMap = new Map<string, Array<(data: any) => void>>();
		for (const handler of this.autocmdHandlers) {
			if (!handlerMap.has(handler.event)) {
				handlerMap.set(handler.event, []);
			}
			handlerMap.get(handler.event)!.push(handler.handler);
		}

		client.on('notification', (method: string, args: any[]) => {
			if (method === 'power-mode') {
				const [payload] = args;
				const { event, data } = payload;

				const handlers = handlerMap.get(event);
				if (handlers && handlers.length > 0) {
					// Call all handlers for this event
					for (const handler of handlers) {
						handler(data);
					}
				} else {
					this.outputChannel.appendLine(`No handler for event: ${event}`);
				}
				return;
			}

			// Log other non-redraw events for debugging
			if (method !== 'redraw') {
				this.outputChannel.appendLine(`Neovim Event: ${method}`);
			}
		});
	}

	dispose(): void {
		if (this.client) {
			this.client.removeAllListeners();
			this.client = null;
		}
	}
}

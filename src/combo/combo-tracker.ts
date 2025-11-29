import * as vscode from 'vscode';
import { ComboMeter } from './combo-meter';
import { NeovimPlugin } from '../nvim/plugin';
import { AutocmdHandler } from '../nvim/neovim-client';

export interface ComboTrackerOptions {
	comboTimeout: number; // seconds
	powermodeThreshold: number;
	outputChannel: vscode.OutputChannel;
}

export class ComboTracker implements NeovimPlugin {
	private readonly comboMeter: ComboMeter;
	private readonly outputChannel: vscode.OutputChannel;
	private readonly comboTimeout: number;
	private readonly powermodeThreshold: number;
	private readonly autocmdHandlers: readonly AutocmdHandler[];

	private currentCombo = 0;
	private comboTimeoutHandle: NodeJS.Timeout | null = null;
	private isPowermodeActive = false;

	constructor(options: ComboTrackerOptions) {
		this.outputChannel = options.outputChannel;
		this.comboTimeout = options.comboTimeout;
		this.powermodeThreshold = options.powermodeThreshold;
		this.comboMeter = new ComboMeter();

		// Define handlers that reference this instance's methods
		this.autocmdHandlers = [
			{
				event: 'TextChangedI',
				handler: (_data) => {
					this.outputChannel.appendLine('Insert mode text change');
					this.handleTextChange();
				},
			},
			{
				event: 'TextChanged',
				handler: (_data) => {
					this.outputChannel.appendLine('Normal mode text change (includes undo/redo)');
					this.handleTextChange();
				},
			},
		];
	}

	public getAutocmdHandlers(): readonly AutocmdHandler[] {
		return this.autocmdHandlers;
	}

	private isReadOnlyEditor(editor: vscode.TextEditor): boolean {
		return /^(output|debug|vscode-.*)/.test(editor.document.uri.scheme);
	}

	private handleTextChange(): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		// Ignore text changes in read-only editors (output panel, debug console, etc.)
		if (this.isReadOnlyEditor(editor)) {
			return;
		}

		this.currentCombo++;
		this.outputChannel.appendLine(`Combo: ${this.currentCombo}`);

		// Check for powermode activation
		if (!this.isPowermodeActive && this.currentCombo >= this.powermodeThreshold) {
			this.isPowermodeActive = true;
			this.comboMeter.onPowermodeStart(this.currentCombo);
			this.outputChannel.appendLine('POWER MODE ACTIVATED!');
		}

		// Reset combo timeout
		if (this.comboTimeoutHandle) {
			clearTimeout(this.comboTimeoutHandle);
		}
		this.comboTimeoutHandle = setTimeout(() => {
			const finalCombo = this.currentCombo;
			if (this.isPowermodeActive) {
				this.comboMeter.onPowermodeStop();
				this.isPowermodeActive = false;
			}
			this.comboMeter.onComboStop();
			this.currentCombo = 0;
			this.outputChannel.appendLine(`Combo ended at: ${finalCombo}`);
		}, this.comboTimeout * 1000);

		this.comboMeter.updateCombo(this.currentCombo, this.comboTimeout, this.isPowermodeActive, editor);
	}

	public dispose(): void {
		this.comboMeter.dispose();
		if (this.comboTimeoutHandle) {
			clearTimeout(this.comboTimeoutHandle);
			this.comboTimeoutHandle = null;
		}
	}
}

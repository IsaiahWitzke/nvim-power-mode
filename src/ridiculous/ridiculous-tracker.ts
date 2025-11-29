import * as vscode from 'vscode';
import { EffectManager } from './effects/EffectManager';
import { XPService } from './xp/XPService';
import { PanelViewProvider } from './view/PanelViewProvider';
import { NeovimPlugin } from '../nvim/plugin';
import { AutocmdHandler } from '../nvim/neovim-client';
import { Settings, PanelMessageFromExt } from './types';

export class RidiculousTracker implements NeovimPlugin {
	private readonly context: vscode.ExtensionContext;
	private readonly autocmdHandlers: readonly AutocmdHandler[];

	private settings: Settings;
	private xp: XPService;
	private effects: EffectManager;
	private panelProvider: PanelViewProvider;
	private status: vscode.StatusBarItem;
	private disposables: vscode.Disposable[] = [];

	// Pitch increase that resets shortly after typing stops
	private pitchIncrease = 0;
	private pitchResetTimer: NodeJS.Timeout | undefined;
	private readonly PITCH_RESET_MS = 180;

	// Track last line for newline detection
	private lastLineByEditor = new WeakMap<vscode.TextEditor, number>();
	private revealedForSound = false;

	// Track operator-pending mode for command chains
	private isInOperatorPending = false;
	private commandBuilder = '';
	private lastMode = '';
	private pendingCount = 0;
	private lastUndoSeq = 0;
	private lastTextChangeTime = 0;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;

		// Load settings
		const cfg = vscode.workspace.getConfiguration("ridiculousCoding");
		this.settings = {
			explosions: cfg.get("explosions", true),
			blips: cfg.get("blips", true),
			chars: cfg.get("chars", true),
			shake: cfg.get("shake", true),
			shakeAmplitude: cfg.get("shakeAmplitude", 6),
			shakeDecayMs: cfg.get("shakeDecayMs", 120),
			sound: cfg.get("sound", true),
			fireworks: cfg.get("fireworks", true),
			baseXp: cfg.get("leveling.baseXp", 50),
			enableStatusBar: cfg.get("enableStatusBar", true),
			reducedEffects: cfg.get("reducedEffects", false)
		};

		console.log('[ridiculous] RidiculousTracker initialized with settings:', this.settings);

		// Initialize services
		console.log('[ridiculous] Initializing XPService...');
		this.xp = new XPService(context, this.settings.baseXp);

		console.log('[ridiculous] Initializing EffectManager...');
		this.effects = new EffectManager(context);

		console.log('[ridiculous] Initializing PanelViewProvider...');
		this.panelProvider = new PanelViewProvider(context);

		// Register webview view provider
		this.disposables.push(
			vscode.window.registerWebviewViewProvider(PanelViewProvider.viewType, this.panelProvider)
		);

		// Create status bar
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.status.command = "ridiculousCoding.showPanel";
		this.disposables.push(this.status);
		this.updateStatus();

		// Register commands
		this.registerCommands();

		// Register configuration change handler
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => this.handleConfigChange(e))
		);

		// Register text document change handler
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(evt => this.handleTextDocumentChange(evt))
		);

		// Register selection change handler
		this.disposables.push(
			vscode.window.onDidChangeTextEditorSelection(e => this.handleSelectionChange(e))
		);

		// Setup autocmd handlers for detecting vim command chains
		// We'll use various events to capture different operations
		this.autocmdHandlers = [
			{
				event: 'ModeChanged',
				handler: (data) => this.handleModeChange(data),
				luaCallback: `
					local mode_info = vim.api.nvim_get_mode()
					local mode = mode_info.mode
					return {
						mode = mode
					}
				`,
			},
			{
				event: 'TextChanged',
				handler: (data) => this.handleTextChangedVim(data),
				luaCallback: `
					-- Store undo sequence number to detect undo/redo
					local undotree = vim.fn.undotree()
					local seq_cur = undotree.seq_cur or 0
					return {
						undoSeq = seq_cur
					}
				`,
			},
			{
				event: 'TextYankPost',
				handler: (data) => this.handleYank(data),
				luaCallback: `
					local event = vim.v.event or {}
					local operator = event.operator or 'y'
					local regtype = event.regtype or 'v'
					local visual = event.visual or false
					return {
						operator = operator,
						regtype = regtype,
						visual = visual
					}
				`,
			},
			{
				event: 'TextChangedI',
				handler: (data) => this.handleInsertModeChange(data),
				luaCallback: `
					-- Track insert mode changes for replace mode detection
					local mode = vim.fn.mode()
					return {
						mode = mode
					}
				`,
			},
		];
	}

	public getAutocmdHandlers(): readonly AutocmdHandler[] {
		return this.autocmdHandlers;
	}

	private registerCommands(): void {
		this.disposables.push(
			vscode.commands.registerCommand("ridiculousCoding.showPanel", () => this.panelProvider.reveal()),
			vscode.commands.registerCommand("ridiculousCoding.resetXp", () => {
				this.xp.reset();
				this.pushState();
				this.updateStatus();
				if (this.settings.fireworks) {
					this.post({ type: "fireworks", enabled: this.settings.sound });
				}
			}),
			vscode.commands.registerCommand("ridiculousCoding.toggleExplosions", () => this.toggle("explosions")),
			vscode.commands.registerCommand("ridiculousCoding.toggleBlips", () => this.toggle("blips")),
			vscode.commands.registerCommand("ridiculousCoding.toggleChars", () => this.toggle("chars")),
			vscode.commands.registerCommand("ridiculousCoding.toggleShake", () => this.toggle("shake")),
			vscode.commands.registerCommand("ridiculousCoding.toggleSound", () => this.toggle("sound")),
			vscode.commands.registerCommand("ridiculousCoding.toggleFireworks", () => this.toggle("fireworks")),
			vscode.commands.registerCommand("ridiculousCoding.toggleReducedEffects", () => this.toggle("reducedEffects"))
		);
	}

	private toggle<K extends keyof Settings>(key: K): void {
		const map: Record<string, string> = {
			explosions: "explosions",
			blips: "blips",
			chars: "chars",
			shake: "shake",
			sound: "sound",
			fireworks: "fireworks",
			baseXp: "leveling.baseXp",
			enableStatusBar: "enableStatusBar",
			reducedEffects: "reducedEffects"
		};
		const configKey = map[key];
		if (!configKey) return;
		const cfg = vscode.workspace.getConfiguration("ridiculousCoding");
		const newVal = !(this.settings[key] as any as boolean);
		cfg.update(configKey, newVal, true);
	}

	private handleConfigChange(e: vscode.ConfigurationChangeEvent): void {
		if (!e.affectsConfiguration("ridiculousCoding")) return;

		const cfg = vscode.workspace.getConfiguration("ridiculousCoding");
		const oldReducedEffects = this.settings.reducedEffects;
		this.settings = {
			explosions: cfg.get("explosions", true),
			blips: cfg.get("blips", true),
			chars: cfg.get("chars", true),
			shake: cfg.get("shake", true),
			shakeAmplitude: cfg.get("shakeAmplitude", 6),
			shakeDecayMs: cfg.get("shakeDecayMs", 120),
			sound: cfg.get("sound", true),
			fireworks: cfg.get("fireworks", true),
			baseXp: cfg.get("leveling.baseXp", 50),
			enableStatusBar: cfg.get("enableStatusBar", true),
			reducedEffects: cfg.get("reducedEffects", false)
		};

		// If reduced effects was just enabled, clear all decorations
		if (!oldReducedEffects && this.settings.reducedEffects) {
			vscode.window.visibleTextEditors.forEach(editor => {
				this.effects.clearAllDecorations(editor);
			});
		}

		this.xp.setBaseXp(this.settings.baseXp);
		this.pushState();
		this.updateStatus();
		this.post({
			type: "state",
			xp: this.xp.xp,
			level: this.xp.level,
			xpNext: this.xp.xpNextAbs,
			xpLevelStart: this.xp.xpStartOfLevel
		});
	}

	private handleTextDocumentChange(evt: vscode.TextDocumentChangeEvent): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor || evt.document !== editor.document) {
			console.log('[ridiculous] handleTextDocumentChange: no editor or document mismatch');
			return;
		}

		const change = evt.contentChanges[0];
		if (!change) {
			console.log('[ridiculous] handleTextDocumentChange: no changes');
			return;
		}

		// Classify
		const insertedText = change.text ?? "";
		const removedChars = change.rangeLength ?? 0;
		const isInsert = insertedText.length > 0;
		const isDelete = !isInsert && removedChars > 0;

		console.log(`[ridiculous] TextChange: insert="${insertedText}", delete=${isDelete}, blips=${this.settings.blips}, reducedEffects=${this.settings.reducedEffects}`);

		const caret = editor.selection.active;
		const charLabel =
			isInsert && this.settings.chars
				? this.sanitizeLabel(insertedText[0] ?? "")
				: isDelete && this.settings.chars
				? "BACKSPACE"
				: undefined;

		if (isInsert && this.settings.blips && !this.settings.reducedEffects) {
			console.log(`[ridiculous] Calling showBlip with label: "${charLabel}"`);
			if (this.settings.sound && !this.revealedForSound) {
				this.revealedForSound = true;
				this.panelProvider.reveal();
			}
			this.effects.showBlip(editor, this.settings.chars, this.settings.shake, charLabel);
			this.pitchIncrease += 1.0;
			if (this.pitchResetTimer) clearTimeout(this.pitchResetTimer);
			this.pitchResetTimer = setTimeout(() => { this.pitchIncrease = 0; }, this.PITCH_RESET_MS);
			const pitch = 1.0 + Math.min(20, this.pitchIncrease) * 0.05;
			this.post({ type: "blip", pitch, enabled: this.settings.sound && !this.settings.reducedEffects });
			const leveled = this.xp.addXp(1);
			if (leveled && this.settings.fireworks && !this.settings.reducedEffects) {
				this.post({ type: "fireworks", enabled: this.settings.sound && !this.settings.reducedEffects });
			}
			this.pushState();
			this.updateStatus();
		} else if (isInsert) {
			const leveled = this.xp.addXp(1);
			this.pushState();
			this.updateStatus();
		} else if (isDelete && this.settings.explosions && !this.settings.reducedEffects) {
			this.effects.showBoom(editor, this.settings.chars, this.settings.shake, charLabel);
			this.post({ type: "boom", enabled: this.settings.sound && !this.settings.reducedEffects });
			this.pushState();
		}

		// Newline detection within this change
		if (this.settings.blips && insertedText.includes("\n") && !this.settings.reducedEffects) {
			this.effects.showNewline(editor, this.settings.shake);
		}

		this.lastLineByEditor.set(editor, caret.line);
	}

	private handleSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
		const editor = e.textEditor;
		const last = this.lastLineByEditor.get(editor);
		const now = editor.selection.active.line;
		if (last !== undefined && now !== last && this.settings.blips && !this.settings.reducedEffects) {
			this.effects.showNewline(editor, this.settings.shake);
		}
		this.lastLineByEditor.set(editor, now);
	}

	private handleModeChange(data: any): void {
		const mode = data.mode || '';

		console.log(`[ridiculous] Mode: ${this.lastMode} -> ${mode}`);

		// Track when entering/exiting operator-pending mode
		if ((mode === 'no' || mode === 'nov' || mode === 'noV') && !this.isInOperatorPending) {
			this.isInOperatorPending = true;
			console.log(`[ridiculous] Entering operator-pending mode`);
		} else if (this.isInOperatorPending && mode !== 'no' && mode !== 'nov' && mode !== 'noV') {
			console.log(`[ridiculous] Exiting operator-pending mode`);
			// Don't reset immediately - let TextChanged handler show the effect
			setTimeout(() => {
				this.isInOperatorPending = false;
			}, 100);
		}

		this.lastMode = mode;
	}

	private handleTextChangedVim(data: any): void {
		// TextChanged fires after delete, change, paste, undo, redo, or other text-modifying operations
		const now = Date.now();
		const undoSeq = data.undoSeq || 0;
		const timeSinceLastChange = now - this.lastTextChangeTime;

		console.log(`[ridiculous] TextChanged: mode=${this.lastMode}, opPending=${this.isInOperatorPending}, undoSeq=${undoSeq}, lastUndoSeq=${this.lastUndoSeq}`);

		// Skip if we're in operator-pending (the operation will be caught by TextYankPost)
		if (this.isInOperatorPending) {
			this.lastUndoSeq = undoSeq;
			this.lastTextChangeTime = now;
			return;
		}

		if (this.lastMode === 'n') {
			// Detect undo (sequence goes backward) or redo (sequence goes forward after undo)
			const seqDelta = undoSeq - this.lastUndoSeq;

			if (this.lastUndoSeq > 0) {
				if (seqDelta < 0) {
					// Undo - sequence decreased
					this.showCommandEffect('UNDO');
				} else if (seqDelta > 0 && timeSinceLastChange < 100) {
					// Redo - sequence increased (and quick timing suggests it's redo not a new edit)
					this.showCommandEffect('REDO');
				} else if (timeSinceLastChange < 100) {
					// Other quick operation in normal mode (paste, repeat, etc.)
					this.showCommandEffect('PASTE');
				}
			}
		}

		this.lastUndoSeq = undoSeq;
		this.lastTextChangeTime = now;
	}

	private handleYank(data: any): void {
		// TextYankPost fires after any yank operation (y, d, c, etc.)
		const operator = data.operator || 'y';
		const visual = data.visual || false;

		console.log(`[ridiculous] Yank event: operator="${operator}", visual=${visual}`);

		// Show effect for yank commands
		if (operator === 'y') {
			this.showCommandEffect('YANK');
		} else if (operator === 'd') {
			this.showCommandEffect('DELETE');
		} else if (operator === 'c') {
			this.showCommandEffect('CHANGE');
		}
	}

	private handleInsertModeChange(data: any): void {
		const mode = data.mode || '';

		// Detect replace mode (R or r)
		if (mode === 'R') {
			console.log('[ridiculous] Replace mode detected');
			// Don't show effect here - it will show on the actual text change
		}
	}

	private showCommandEffect(command: string): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !command || this.settings.reducedEffects) {
			return;
		}

		console.log(`[ridiculous] Showing effect for command: "${command}"`);

		// Show the command as a text effect with boom animation
		if (this.settings.chars) {
			this.effects.showBoom(editor, true, this.settings.shake, command);
		}

		// Play boom sound for commands
		if (this.settings.sound) {
			this.post({ type: "boom", enabled: true });
		}
	}

	private sanitizeLabel(ch: string): string {
		if (ch === "\n") return "";
		if (ch === "\t") return "↹";
		if (ch.trim() === "") return "SPACE";
		return ch;
	}

	private updateStatus(): void {
		if (!this.settings.enableStatusBar) {
			this.status.hide();
			return;
		}
		const prog = this.xp.progress;
		this.status.text = `$(rocket) RC Lv ${this.xp.level} — ${prog.current}/${prog.max} XP`;
		this.status.tooltip = `Ridiculous Coding\nLevel ${this.xp.level}\n${prog.current}/${prog.max} XP`;
		this.status.show();
	}

	private post(msg: PanelMessageFromExt): void {
		this.panelProvider.post(msg);
	}

	private pushState(): void {
		this.post({
			type: "state",
			xp: this.xp.xp,
			level: this.xp.level,
			xpNext: this.xp.xpNextAbs,
			xpLevelStart: this.xp.xpStartOfLevel
		});
	}

	public dispose(): void {
		this.effects.dispose();
		if (this.pitchResetTimer) {
			clearTimeout(this.pitchResetTimer);
		}
		while (this.disposables.length) {
			this.disposables.shift()?.dispose();
		}
	}
}

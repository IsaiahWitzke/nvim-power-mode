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

		// Initialize services
		this.xp = new XPService(context, this.settings.baseXp);
		this.effects = new EffectManager(context);
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

		// No autocmd handlers needed - we use VSCode events directly
		this.autocmdHandlers = [];
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
		if (!editor || evt.document !== editor.document) return;

		const change = evt.contentChanges[0];
		if (!change) return;

		// Classify
		const insertedText = change.text ?? "";
		const removedChars = change.rangeLength ?? 0;
		const isInsert = insertedText.length > 0;
		const isDelete = !isInsert && removedChars > 0;

		const caret = editor.selection.active;
		const charLabel =
			isInsert && this.settings.chars
				? this.sanitizeLabel(insertedText[0] ?? "")
				: isDelete && this.settings.chars
				? "BACKSPACE"
				: undefined;

		if (isInsert && this.settings.blips && !this.settings.reducedEffects) {
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

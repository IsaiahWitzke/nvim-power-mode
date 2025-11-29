import * as vscode from 'vscode';

const BASE_CSS = {
	'position': 'absolute',
	'top': '60px',
	'font-family': 'monospace',
	'font-weight': '900',
	'z-index': '1',
	'pointer-events': 'none',
	'text-align': 'center',
} as const;

const COUNTER_SIZE = 3;

function toCss(obj: Record<string, string | number>): string {
	return Object.entries(obj).map(([k, v]) => `${k}: ${v};`).join(' ');
}

export class ComboMeter {
	private disposables: vscode.Disposable[] = [];
	private comboTimerDecoration: vscode.TextEditorDecorationType | null = null;
	private comboCountDecoration: vscode.TextEditorDecorationType | null = null;
	private comboTimerInterval: NodeJS.Timeout | null = null;
	private comboCountAnimationTimeout: NodeJS.Timeout | null = null;

	private renderedRange?: vscode.Range;
	private renderedComboCount?: number;
	private combo = 0;
	private isPowermodeActive = false;
	private initialPowermodeCombo = 0;
	private timerDuration = 0;
	private timerExpiration = 0;
	private activeEditor: vscode.TextEditor | null = null;

	constructor() {
		this.disposables.push(
			vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
				if (this.activeEditor === e.textEditor) {
					this.updateDecorations(e.textEditor);
				}
			})
		);
	}

	public dispose() {
		this.clearDecorations();
		this.disposables.forEach(d => d.dispose());
	}

	public onPowermodeStart(combo: number) {
		this.isPowermodeActive = true;
		this.initialPowermodeCombo = combo;
	}

	public onPowermodeStop() {
		this.isPowermodeActive = false;
		this.initialPowermodeCombo = 0;
	}

	public onComboStop() {
		this.combo = 0;
		this.activeEditor = null;
		this.clearDecorations();
	}

	public updateCombo(combo: number, comboTimeout: number, isPowermodeActive: boolean, editor: vscode.TextEditor) {
		this.combo = combo;
		this.timerDuration = comboTimeout * 1000;
		this.timerExpiration = Date.now() + this.timerDuration;
		this.isPowermodeActive = isPowermodeActive;

		// Skip read-only editors
		if (!/^(output|debug|vscode-.*)/.test(editor.document.uri.scheme)) {
			this.activeEditor = editor;
		}

		if (this.activeEditor) {
			this.updateDecorations(this.activeEditor);
		}
	}

	private clearDecorations() {
		this.renderedComboCount = 0;
		this.renderedRange = undefined;
		this.comboCountDecoration?.dispose();
		this.comboCountDecoration = null;
		this.comboTimerDecoration?.dispose();
		this.comboTimerDecoration = null;
		if (this.comboCountAnimationTimeout) clearTimeout(this.comboCountAnimationTimeout);
		if (this.comboTimerInterval) clearInterval(this.comboTimerInterval);
		this.comboCountAnimationTimeout = null;
		this.comboTimerInterval = null;
	}

	private getBaseCss(): string {
		const minimapEnabled = vscode.workspace.getConfiguration('editor').get<boolean>('minimap.enabled', true);
		const rightOffset = minimapEnabled ? '45rem' : '35rem';
		return toCss({ ...BASE_CSS, 'left': `calc(100vw - ${rightOffset})` });
	}

	/**
	 * Calculates visual styles that scale with powermode intensity.
	 * @param frameCount - Animation frame (0-100) for the "pop" effect when combo increases
	 */
	private getStyles(comboCount: number, frameCount = 0) {
		// How many combos since powermode started (0 if not in powermode)
		const powerModeCombo = this.isPowermodeActive ? comboCount - this.initialPowermodeCombo : 0;
		// Cap the style scaling at 25 to prevent it from getting too extreme
		const styleCount = Math.min(powerModeCombo, 25);

		// Text size calculation:
		// - Base size is COUNTER_SIZE (3em)
		// - In powermode, adds a bonus that grows with combo count
		// - The 0.5^(frameCount*0.2) creates a "pop" animation that decays over frames
		//   (starts large, shrinks back to base size)
		const textSize = this.isPowermodeActive
			? (styleCount * COUNTER_SIZE) / 100 * 0.5 ** (frameCount * 0.2) + COUNTER_SIZE
			: COUNTER_SIZE;

		// Color shifts from green (hsl 100) toward red (hsl 0) as powermode combo increases
		const color = `hsl(${100 - powerModeCombo * 1.2}, 100%, 45%)`;

		return { textSize: `${textSize}em`, color };
	}

	private updateDecorations(editor: vscode.TextEditor) {
		const firstVisibleRange = editor.visibleRanges.find(r => !r.isEmpty);
		if (!firstVisibleRange || this.combo < 1) {
			this.clearDecorations();
			return;
		}

		const range = new vscode.Range(firstVisibleRange.start, firstVisibleRange.start);
		if (this.combo === this.renderedComboCount && this.renderedRange?.isEqual(range)) return;

		this.renderedComboCount = this.combo;
		this.renderedRange = range;
		this.renderComboCount(this.combo, [range]);
		this.renderTimer([range]);
	}

	private renderTimer(ranges: vscode.Range[]) {
		if (this.comboTimerInterval) { clearInterval(this.comboTimerInterval); }
		const baseCss = this.getBaseCss();

		const tick = () => {
			if (!this.activeEditor) {
				this.comboTimerDecoration?.dispose();
				if (this.comboTimerInterval) { clearInterval(this.comboTimerInterval); }
				return;
			}

			const timeLeft = this.timerExpiration - Date.now();
			if (timeLeft <= 0) {
				if (this.comboTimerInterval) { clearInterval(this.comboTimerInterval); } 
				this.comboTimerDecoration?.dispose();
				return;
			}

			const { textSize, color } = this.getStyles(this.combo);
			const sizeCss = toCss({ 'font-size': textSize, 'box-shadow': `0 0 15px ${color}` });

			// Timer bar width shrinks proportionally as time runs out (1.5em at full, 0 at expiry)
			const timerWidth = (timeLeft / this.timerDuration) * 1.5;
			const decoration = vscode.window.createTextEditorDecorationType({
				before: {
					contentText: '',
					backgroundColor: 'white',
					width: `${timerWidth}em`,
					color: 'white',
					height: '8px',
					textDecoration: `none; ${baseCss} ${sizeCss}`,
				},
				rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			});

			this.activeEditor.setDecorations(decoration, ranges);
			this.comboTimerDecoration?.dispose();
			this.comboTimerDecoration = decoration;
		};

		this.comboTimerInterval = setInterval(tick, 50);
	}

	private renderComboCount(count: number, ranges: vscode.Range[]) {
		if (this.comboCountAnimationTimeout) { clearTimeout(this.comboCountAnimationTimeout); }
		const baseCss = this.getBaseCss();

		const animate = (frame: number) => {
			if (!this.activeEditor) {
				this.comboCountDecoration?.dispose();
				return;
			}

			this.comboCountDecoration?.dispose();
			const { textSize, color } = this.getStyles(count, frame);
			const sizeCss = toCss({ 'font-size': textSize, 'text-shadow': `0 0 15px ${color}` });

			const decoration = vscode.window.createTextEditorDecorationType({
				after: {
					margin: '0.5em 0 0 0',
					contentText: `${count}×`,
					color: '#FFFFFF',
					textDecoration: `none; ${baseCss} ${sizeCss}`,
				},
				rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			});

			this.activeEditor.setDecorations(decoration, ranges);
			this.comboCountDecoration = decoration;

			// In powermode, animate the "pop" effect over 100 frames
			// Delay increases slightly each frame (20ms -> 70ms) for easing effect
			if (this.isPowermodeActive && frame < 100) {
				this.comboCountAnimationTimeout = setTimeout(() => animate(frame + 1), 20 + 0.5 * frame);
			}
		};

		animate(0);
	}
}

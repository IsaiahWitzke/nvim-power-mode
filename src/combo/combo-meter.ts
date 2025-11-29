import * as vscode from 'vscode';

export class ComboMeter {
	private disposables: vscode.Disposable[] = [];
	private comboTimerDecoration: vscode.TextEditorDecorationType | null = null;
	private comboCountDecoration: vscode.TextEditorDecorationType | null = null;

	private renderedRange?: vscode.Range;
	private renderedComboCount?: number;
	private combo: number = 0;
	private isPowermodeActive: boolean = false;
	private initialPowermodeCombo: number = 0;

	private timerDurationInMilliseconds = 0;
	private timerExpirationTimestampInMilliseconds = 0;

	private comboTimerDecorationTimer: NodeJS.Timeout | null = null;
	private comboCountAnimationTimer: NodeJS.Timeout | null = null;

	private counterSize = 3;
	private activeEditor: vscode.TextEditor | null = null;

	private static readonly DEFAULT_CSS: Record<string, string | number> = {
		'position': 'absolute',
		'left': 'calc(100vw - 35rem)',
		'top': '20px',
		'font-family': 'monospace',
		'font-weight': '900',
		'z-index': '1',
		'pointer-events': 'none',
		'text-align': 'center',
	};

	constructor() {
		this.disposables.push(vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
			// Only update if this is the editor we're tracking
			if (this.activeEditor && e.textEditor === this.activeEditor) {
				this.updateDecorations(e.textEditor);
			}
		}));
	}

	public dispose() {
		this.removeDecorations();
		while (this.disposables.length) {
			this.disposables.shift()?.dispose();
		}
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
		this.removeDecorations();
	}

	public updateCombo(combo: number, comboTimeout: number, isPowermodeActive: boolean, editor: vscode.TextEditor) {
		this.combo = combo;
		this.timerDurationInMilliseconds = comboTimeout * 1000;
		this.timerExpirationTimestampInMilliseconds = Date.now() + this.timerDurationInMilliseconds;
		this.isPowermodeActive = isPowermodeActive;

		// Only switch active editor if the new editor is not read-only
		if (!editor.document.uri.scheme.match(/^(output|debug|vscode-.*)/)) {
			this.activeEditor = editor;
		}

		if (this.activeEditor) {
			this.updateDecorations(this.activeEditor);
		}
	}

	private removeDecorations() {
		this.renderedComboCount = 0;
		this.renderedRange = undefined;

		if (this.comboCountDecoration) {
			this.comboCountDecoration.dispose();
			this.comboCountDecoration = null;
		}
		if (this.comboCountAnimationTimer) {
			clearTimeout(this.comboCountAnimationTimer);
			this.comboCountAnimationTimer = null;
		}
		if (this.comboTimerDecoration) {
			this.comboTimerDecoration.dispose();
			this.comboTimerDecoration = null;
		}
		if (this.comboTimerDecorationTimer) {
			clearInterval(this.comboTimerDecorationTimer);
			this.comboTimerDecorationTimer = null;
		}
	}

	private updateDecorations(editor: vscode.TextEditor) {
		const firstVisibleRange = editor.visibleRanges.find(range => !range.isEmpty);
		if (!firstVisibleRange || this.combo < 1) {
			this.removeDecorations();
			return;
		}

		const position = firstVisibleRange.start;
		const range = new vscode.Range(position, position);

		if (this.combo !== this.renderedComboCount || !this.renderedRange || !range.isEqual(this.renderedRange)) {
			this.renderedComboCount = this.combo;
			this.renderedRange = range;
			const ranges = [range];
			this.createComboCountDecoration(this.combo, ranges);
			this.createComboTimerDecoration(ranges);
		}
	}

	private getSharedStyles(comboCount: number, frameCount = 0): { textSize: string, color: string } {
		const powerModeCombo = this.isPowermodeActive ? comboCount - this.initialPowermodeCombo : 0;
		const styleCount = Math.min(powerModeCombo, 25);
		const textSize = this.isPowermodeActive
			? ((styleCount * this.counterSize) / 100 * 0.5 ** (frameCount * 0.2) + this.counterSize)
			: this.counterSize;
		const color = `hsl(${100 - (this.isPowermodeActive ? powerModeCombo : 0) * 1.2}, 100%, 45%)`;
		return { textSize: `${textSize}em`, color };
	}

	private createComboTimerDecoration(ranges: vscode.Range[]) {
		if (this.comboTimerDecorationTimer) {
			clearInterval(this.comboTimerDecorationTimer);
		}

		const baseCss = ComboMeter.objectToCssString(ComboMeter.DEFAULT_CSS);

		const updateTimer = () => {
			// Stop if no active editor or editor changed
			if (!this.activeEditor) {
				this.comboTimerDecoration?.dispose();
				if (this.comboTimerDecorationTimer) {
					clearInterval(this.comboTimerDecorationTimer);
				}
				return;
			}

			const timeLeft = this.timerExpirationTimestampInMilliseconds - Date.now();
			if (timeLeft <= 0) {
				if (this.comboTimerDecorationTimer) {
					clearInterval(this.comboTimerDecorationTimer);
				}
				this.comboTimerDecoration?.dispose();
				return;
			}

			const timerWidth = (timeLeft / this.timerDurationInMilliseconds) * 1.5;
			const { textSize, color } = this.getSharedStyles(this.combo);

			const sizeCss = ComboMeter.objectToCssString({
				'font-size': textSize,
				'box-shadow': `0px 0px 15px ${color}`,
			});

			const newDecoration = vscode.window.createTextEditorDecorationType({
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

			this.activeEditor.setDecorations(newDecoration, ranges);
			this.comboTimerDecoration?.dispose();
			this.comboTimerDecoration = newDecoration;
		};

		this.comboTimerDecorationTimer = setInterval(updateTimer, 50);
	}

	private createComboCountDecoration(count: number, ranges: vscode.Range[]) {
		if (this.comboCountAnimationTimer) {
			clearTimeout(this.comboCountAnimationTimer);
		}

		const baseCss = ComboMeter.objectToCssString(ComboMeter.DEFAULT_CSS);

		const animate = (frameCount: number) => {
			// Stop if no active editor
			if (!this.activeEditor) {
				this.comboCountDecoration?.dispose();
				return;
			}

			this.comboCountDecoration?.dispose();

			const { textSize, color } = this.getSharedStyles(count, frameCount);

			const sizeCss = ComboMeter.objectToCssString({
				'font-size': textSize,
				'text-shadow': `0px 0px 15px ${color}`,
			});

			const newDecoration = vscode.window.createTextEditorDecorationType({
				after: {
					margin: '0.5em 0 0 0',
					contentText: `${count}×`,
					color: '#FFFFFF',
					textDecoration: `none; ${baseCss} ${sizeCss}`,
				},
				rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			});

			this.activeEditor.setDecorations(newDecoration, ranges);
			this.comboCountDecoration?.dispose();
			this.comboCountDecoration = newDecoration;

			if (this.isPowermodeActive && frameCount < 100) {
				this.comboCountAnimationTimer = setTimeout(() => animate(frameCount + 1), 20 + (0.5 * frameCount));
			}
		};

		animate(0);
	}

	private static objectToCssString(settings: Record<string, string | number>): string {
		return Object.entries(settings).map(([k, v]) => `${k}: ${v};`).join(' ');
	}
}

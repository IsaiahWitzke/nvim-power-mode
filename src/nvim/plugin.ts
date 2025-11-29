import { AutocmdHandler } from './neovim-client';

/**
 * Interface for plugins that need to register NeoVim autocmd handlers.
 * Each plugin manages its own handlers internally.
 */
export interface NeovimPlugin {
	/**
	 * Returns the autocmd handlers this plugin needs registered.
	 * Called once during extension activation.
	 */
	getAutocmdHandlers(): readonly AutocmdHandler[];

	/**
	 * Cleanup resources when the extension is deactivated.
	 */
	dispose(): void;
}

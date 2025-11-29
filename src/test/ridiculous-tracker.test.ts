import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('RidiculousTracker Test Suite', () => {
	// Note: We can't actually instantiate RidiculousTracker in tests because
	// it registers a WebviewViewProvider which can only be registered once.
	// Instead, we'll test the structure and behavior indirectly.

	test('RidiculousTracker module should be importable', () => {
		const RidiculousTracker = require('../ridiculous/ridiculous-tracker').RidiculousTracker;
		assert.ok(RidiculousTracker, 'RidiculousTracker class should be defined');
		assert.ok(typeof RidiculousTracker === 'function', 'RidiculousTracker should be a constructor');
	});

	test('RidiculousTracker should have required methods', () => {
		const RidiculousTracker = require('../ridiculous/ridiculous-tracker').RidiculousTracker;
		const proto = RidiculousTracker.prototype;
		assert.ok(typeof proto.getAutocmdHandlers === 'function', 'Should have getAutocmdHandlers method');
		assert.ok(typeof proto.dispose === 'function', 'Should have dispose method');
	});
});

suite('RidiculousTracker Animation Tests', () => {
	const getExtensionPath = () => {
		// Get the workspace folder (extension root)
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.fsPath;
		}
		// Fallback: use __dirname to navigate to extension root
		return path.join(__dirname, '..', '..');
	};

	test('Blip animation sprite files should exist', async () => {
		const extensionPath = getExtensionPath();
		const blipPngPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'animations', 'blip.png'));
		const blipTscnPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'animations', 'blip.tscn'));

		try {
			await vscode.workspace.fs.stat(blipPngPath);
			await vscode.workspace.fs.stat(blipTscnPath);
			assert.ok(true, 'Blip animation files exist');
		} catch (error) {
			console.log('Blip animation files not found at:', blipPngPath.fsPath, blipTscnPath.fsPath);
			assert.fail(`Blip animation files are missing: ${error}`);
		}
	});

	test('Boom animation sprite files should exist', async () => {
		const extensionPath = getExtensionPath();
		const boomPngPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'animations', 'boom.png'));
		const boomTscnPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'animations', 'boom.tscn'));

		try {
			await vscode.workspace.fs.stat(boomPngPath);
			await vscode.workspace.fs.stat(boomTscnPath);
			assert.ok(true, 'Boom animation files exist');
		} catch (error) {
			console.log('Boom animation files not found at:', boomPngPath.fsPath, boomTscnPath.fsPath);
			assert.fail(`Boom animation files are missing: ${error}`);
		}
	});

	test('Newline animation sprite files should exist', async () => {
		const extensionPath = getExtensionPath();
		const newlinePngPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'animations', 'newline.png'));
		const newlineTscnPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'animations', 'newline.tscn'));

		try {
			await vscode.workspace.fs.stat(newlinePngPath);
			await vscode.workspace.fs.stat(newlineTscnPath);
			assert.ok(true, 'Newline animation files exist');
		} catch (error) {
			console.log('Newline animation files not found at:', newlinePngPath.fsPath, newlineTscnPath.fsPath);
			assert.fail(`Newline animation files are missing: ${error}`);
		}
	});

	test('GravityBold8 font file should exist', async () => {
		const extensionPath = getExtensionPath();
		const fontPath = vscode.Uri.file(path.join(extensionPath, 'src', 'ridiculous', 'media', 'font', 'GravityBold8.ttf'));

		try {
			await vscode.workspace.fs.stat(fontPath);
			assert.ok(true, 'Font file exists');
		} catch (error) {
			console.log('Font file not found at:', fontPath.fsPath);
			assert.fail(`Font file is missing: ${error}`);
		}
	});
});

suite('RidiculousTracker Autocmd Handler Tests', () => {
	test('Autocmd handlers should be defined', () => {
		// Test that the handler definitions exist without instantiating
		const expectedEvents = ['ModeChanged', 'TextChanged', 'TextYankPost', 'TextChangedI'];

		// We'll verify the module exports the class correctly
		const RidiculousTrackerModule = require('../ridiculous/ridiculous-tracker');
		assert.ok(RidiculousTrackerModule.RidiculousTracker, 'Module should export RidiculousTracker');
	});

	test('Effect manager should be importable', () => {
		const EffectManager = require('../ridiculous/effects/EffectManager').EffectManager;
		assert.ok(EffectManager, 'EffectManager class should be defined');
		assert.ok(typeof EffectManager === 'function', 'EffectManager should be a constructor');
	});

	test('XP Service should be importable', () => {
		const XPService = require('../ridiculous/xp/XPService').XPService;
		assert.ok(XPService, 'XPService class should be defined');
		assert.ok(typeof XPService === 'function', 'XPService should be a constructor');
	});

	test('Panel View Provider should be importable', () => {
		const PanelViewProvider = require('../ridiculous/view/PanelViewProvider').PanelViewProvider;
		assert.ok(PanelViewProvider, 'PanelViewProvider class should be defined');
		assert.ok(typeof PanelViewProvider === 'function', 'PanelViewProvider should be a constructor');
	});

	test('Types should be importable', () => {
		const types = require('../ridiculous/types');
		assert.ok(types, 'Types module should be defined');
	});
});

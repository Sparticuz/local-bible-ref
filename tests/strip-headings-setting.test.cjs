/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function createObsidianRuntime(overrides = {}) {
	class ObsidianBase {
		constructor(app) {
			this.app = app;
		}
	}

	return {
		AbstractInputSuggest: ObsidianBase,
		EditorSuggest: ObsidianBase,
		Notice: class {},
		Plugin: class {},
		PluginSettingTab: ObsidianBase,
		Setting: class {},
		SettingGroup: class {},
		TFolder: class {},
		getLanguage: () => 'en',
		normalizePath: (path) => path,
		...overrides,
	};
}

function loadExports(entryPoint, obsidian = {}) {
	const result = buildSync({
		entryPoints: [entryPoint],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		write: false,
		external: ['obsidian'],
	});
	const bundledModule = { exports: {} };
	vm.runInNewContext(result.outputFiles[0].text, {
		module: bundledModule,
		exports: bundledModule.exports,
		require(id) {
			return id === 'obsidian' ? createObsidianRuntime(obsidian) : require(id);
		},
	});
	return bundledModule.exports;
}

test('existing settings default to stripping headings', async () => {
	let storedSettings = {
		biblesPath: 'Bible',
		defaultVersionShorthand: 'CSB',
		defaultPassageFormat: 'paragraph',
		bibleFormat: 'localBibleRef',
		fullPreview: false,
		quote: {
			includeReference: true,
			referencePosition: 'end',
			linkToPassage: true,
		},
		callout: {
			type: 'quote',
			linkToPassage: true,
			collapsible: true,
		},
	};

	class Plugin {
		async loadData() {
			return storedSettings;
		}

		async saveData(settings) {
			storedSettings = JSON.parse(JSON.stringify(settings));
		}
	}

	const LocalBibleRefPlugin = loadExports('main.ts', { Plugin }).default;
	const plugin = new LocalBibleRefPlugin();
	await plugin.loadSettings();

	assert.equal(plugin.settings.stripHeadings, true);
	assert.equal(storedSettings.stripHeadings, true);
});

test('the strip-headings setting is localized in every supported language', () => {
	const { I18N } = loadExports('src/i18n/index.ts');

	for (const language of ['CS', 'DE', 'EN', 'KO']) {
		const control = I18N[language].SETTINGS.optional.controls.stripHeadings;
		assert.ok(control.name, language);
		assert.ok(control.description, language);
	}
});

test('section headings are stripped or retained in inserted paragraphs', async () => {
	const PassageSuggest = loadExports('src/passage-suggest.ts').default;
	const chapterText = [
		'> <sup>16</sup> For God so loved the world.',
		'#### A section heading',
		'> <sup>17</sup> For God did not send the Son!',
	].join('\n');
	const app = {
		vault: {
			getFolderByPath: () => null,
			getFileByPath: (path) => ({ path }),
			cachedRead: async () => chapterText,
		},
	};
	for (const stripHeadings of [true, false]) {
		const suggest = new PassageSuggest(app, {
			biblesPath: 'Bibles',
			defaultVersionShorthand: 'ESV',
			defaultPassageFormat: 'paragraph',
			bibleFormat: 'localBibleRef',
			fullPreview: false,
			stripHeadings,
		});
		const suggestions = await suggest.getSuggestions({
			query: '--John 1:16-17',
		});
		assert.equal(suggestions.length, 1);
		assert.equal(
			suggestions[0].text,
			'>  <sup>16</sup> For God so loved the world.\n' +
				(stripHeadings ? '' : '#### A section heading\n') +
				'> <sup>17</sup> For God did not send the Son!\n\n'
		);
	}
});

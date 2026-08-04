/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

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
	const context = {
		module: bundledModule,
		exports: bundledModule.exports,
		require(id) {
			if (id === 'obsidian') {
				return {
					getLanguage: () => 'en',
					...obsidian,
				};
			}

			return require(id);
		},
	};

	vm.runInNewContext(result.outputFiles[0].text, context);
	return bundledModule.exports;
}

function loadModule(entryPoint, obsidian = {}) {
	return loadExports(entryPoint, obsidian).default;
}

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
		normalizePath: (path) => path,
		...overrides,
	};
}

function createPassageSuggest(
	chapterText,
	format = 'paragraph',
	omissionMarker = 'none'
) {
	class TFolder {}
	const PassageSuggest = loadModule('src/passage-suggest.ts', {
		EditorSuggest: class {
			constructor(app) {
				this.app = app;
			}
		},
		Notice: class {},
		TFolder,
		normalizePath: (path) => path,
	});
	const app = {
		vault: {
			getFolderByPath: () => null,
			getFileByPath: (path) => ({ path }),
			cachedRead: async (file) =>
				typeof chapterText === 'function'
					? chapterText(file.path)
					: chapterText,
		},
	};
	const settings = {
		biblesPath: 'Bibles',
		defaultVersionShorthand: 'WEB',
		defaultPassageFormat: format,
		bibleFormat: 'localBibleRef',
		fullPreview: false,
		omissionMarker,
		quote: {
			includeReference: false,
			referencePosition: 'end',
			linkToPassage: false,
		},
		callout: {
			type: 'quote',
			linkToPassage: false,
			collapsible: false,
		},
	};

	return new PassageSuggest(app, settings);
}

const genesisOne = [
	'<sup>1</sup> In the beginning.',
	'<sup>2</sup> The earth was formless.',
	'<sup>3</sup> God said, “Let there be light.”',
].join('\n');
const genesisTwo = [
	'<sup>1</sup> The heavens and earth were completed.',
	'<sup>2</sup> God rested from his work.',
	'<sup>3</sup> God blessed the seventh day.',
].join('\n');

test('a reference can select noncontiguous individual verses', () => {
	const PassageReference = loadModule('src/passage-reference.ts');

	const reference = PassageReference.parse('--gen1:1,3', 'WEB', 'paragraph');

	assert.notEqual(reference, null);
	assert.equal(reference.stringify(), 'Genesis 1:1,3 - WEB');
});

test('a verse selection adds only the requested verse text', async () => {
	const passageSuggest = createPassageSuggest(genesisOne);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1,3',
	});

	assert.equal(suggestions.length, 1);
	assert.equal(
		suggestions[0].text,
		'<sup>1</sup> In the beginning.\n<sup>3</sup> God said, “Let there be light.”\n\n'
	);
});

test('individual verses are ordered and included once', async () => {
	const passageSuggest = createPassageSuggest(genesisOne);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:3,1,3',
	});

	assert.equal(suggestions.length, 1);
	assert.equal(
		suggestions[0].text,
		'<sup>1</sup> In the beginning.\n<sup>3</sup> God said, “Let there be light.”\n\n'
	);
});

test('verse ranges are sorted and merged with overlaps and adjacency', async () => {
	const PassageReference = loadModule('src/passage-reference.ts');
	const reference = PassageReference.parse(
		'--gen1:3,1,2-3',
		'WEB',
		'paragraph'
	);

	assert.notEqual(reference, null);
	assert.equal(reference.stringify(), 'Genesis 1:1-3 - WEB');
	assert.deepEqual(
		Array.from(reference.verseSegments, (segment) => ({ ...segment })),
		[{ startVerse: 1, endVerse: 3 }]
	);

	const passageSuggest = createPassageSuggest(genesisOne);
	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:3,1,2-3',
	});
	assert.equal(suggestions.length, 1);
	assert.equal(suggestions[0].text, `${genesisOne}\n\n`);
});

test('noncontiguous normalized ranges remain visible in labels and output', async () => {
	const fiveVerses = [
		'<sup>1</sup> One.',
		'<sup>2</sup> Two.',
		'<sup>3</sup> Three.',
		'<sup>4</sup> Four.',
		'<sup>5</sup> Five.',
	].join('\n');
	const PassageReference = loadModule('src/passage-reference.ts');
	const reference = PassageReference.parse(
		'-- Gen 1:5, 1 - 2, 4-5',
		'WEB',
		'paragraph'
	);

	assert.notEqual(reference, null);
	assert.equal(reference.stringify(), 'Genesis 1:1-2,4-5 - WEB');

	const passageSuggest = createPassageSuggest(fiveVerses);
	const suggestions = await passageSuggest.getSuggestions({
		query: '-- Gen 1:5, 1 - 2, 4-5',
	});
	assert.equal(suggestions.length, 1);
	assert.equal(
		suggestions[0].text,
		'<sup>1</sup> One.\n<sup>2</sup> Two.\n<sup>4</sup> Four.\n<sup>5</sup> Five.\n\n'
	);
});

test('a missing selected verse rejects the complete reference', async () => {
	const passageSuggest = createPassageSuggest(genesisOne);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1,999',
	});

	assert.equal(suggestions.length, 0);
});

test('a range containing a missing verse rejects the complete reference', async () => {
	const passageSuggest = createPassageSuggest(genesisOne);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1-999,2',
	});

	assert.equal(suggestions.length, 0);
});

test('a range with a missing verse between its endpoints is rejected', async () => {
	const passageSuggest = createPassageSuggest(
		['<sup>1</sup> One.', '<sup>3</sup> Three.'].join('\n')
	);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1-3,3',
	});

	assert.equal(suggestions.length, 0);
});

test('malformed and cross-chapter selections are rejected', () => {
	const PassageReference = loadModule('src/passage-reference.ts');
	const invalidReferences = [
		'--gen1:1,',
		'--gen1:1,,3',
		'--gen1:1,2:3',
		'--gen1:5-3,8',
		'--gen1:1,  3',
		'--gen1:1 -  3,5',
		'--gen1,3',
	];

	for (const input of invalidReferences) {
		assert.equal(
			PassageReference.parse(input, 'WEB', 'paragraph'),
			null,
			input
		);
	}
});

test('existing reference forms and options remain unchanged', () => {
	const PassageReference = loadModule('src/passage-reference.ts');
	const cases = [
		['--gen1:1', 'Genesis 1:1 - WEB'],
		['--gen1:1-3', 'Genesis 1:1-3 - WEB'],
		['--gen1', 'Genesis 1 - WEB'],
		['--gen1-3', 'Genesis 1-3 - WEB'],
		['--gen1:3-3:9', 'Genesis 1:3-3:9 - WEB'],
	];

	for (const [input, output] of cases) {
		const reference = PassageReference.parse(input, 'WEB', 'paragraph');
		assert.notEqual(reference, null, input);
		assert.equal(reference.stringify(), output, input);
	}

	const referenceWithOptions = PassageReference.parse(
		'--gen1:1,3+q+esv',
		'WEB',
		'paragraph'
	);
	assert.equal(referenceWithOptions.stringify(), 'Genesis 1:1,3 - ESV');
	assert.equal(referenceWithOptions.format, 'quote');
});

test('existing references retain their inserted output behavior', async () => {
	const passageSuggest = createPassageSuggest((path) =>
		path.endsWith('Genesis 2.md') ? genesisTwo : genesisOne
	);
	const cases = [
		['--gen1:2', '<sup>2</sup> The earth was formless.\n\n'],
		[
			'--gen1:1-2',
			'<sup>1</sup> In the beginning.\n<sup>2</sup> The earth was formless.\n\n',
		],
		['--gen1', `${genesisOne}\n\n`],
		['--gen1-2', `**1** ${genesisOne}\n\n**2** ${genesisTwo}\n\n`],
		[
			'--gen1:2-2:2+q+esv',
			'> **1** <sup>2</sup> The earth was formless.\n' +
				'> <sup>3</sup> God said, “Let there be light.”\n> \n' +
				'> **2** <sup>1</sup> The heavens and earth were completed.\n' +
				'> <sup>2</sup> God rested from his work.\n\n',
		],
	];

	for (const [query, expected] of cases) {
		const suggestions = await passageSuggest.getSuggestions({ query });
		assert.equal(suggestions.length, 1, query);
		assert.equal(suggestions[0].text, expected, query);
	}
});

test('ellipsis markers appear once per omitted span', async () => {
	const fiveVerses = [
		'<sup>1</sup> One.',
		'<sup>2</sup> Two.',
		'<sup>3</sup> Three.',
		'<sup>4</sup> Four.',
		'<sup>5</sup> Five.',
	].join('\n');
	const passageSuggest = createPassageSuggest(
		fiveVerses,
		'paragraph',
		'ellipsis'
	);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1,3,5',
	});

	assert.equal(
		suggestions[0].text,
		'<sup>1</sup> One. … <sup>3</sup> Three. … <sup>5</sup> Five.\n\n'
	);
});

test('ellipsis markers are not added between adjacent selections', async () => {
	const passageSuggest = createPassageSuggest(
		genesisOne,
		'paragraph',
		'ellipsis'
	);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1,2',
	});

	assert.equal(
		suggestions[0].text,
		'<sup>1</sup> In the beginning.\n<sup>2</sup> The earth was formless.\n\n'
	);
});

test('verse selections retain each existing output format', async (t) => {
	const expectedByFormat = {
		manuscript: 'In the beginning. God said, “Let there be light.”\n\n',
		paragraph:
			'<sup>1</sup> In the beginning.\n<sup>3</sup> God said, “Let there be light.”\n\n',
		quote:
			'> <sup>1</sup> In the beginning.\n> <sup>3</sup> God said, “Let there be light.”\n\n',
		callout:
			'> [!quote] Genesis 1:1,3 - WEB\n> <sup>1</sup> In the beginning.\n> <sup>3</sup> God said, “Let there be light.”\n\n',
	};

	for (const [format, expected] of Object.entries(expectedByFormat)) {
		await t.test(format, async () => {
			const passageSuggest = createPassageSuggest(genesisOne, format);
			const suggestions = await passageSuggest.getSuggestions({
				query: '--gen1:1,3',
			});

			assert.equal(suggestions[0].text, expected);
		});
	}
});

test('omission marker labels are localized in every supported language', () => {
	const { I18N } = loadExports('src/i18n/index.ts', createObsidianRuntime());

	for (const language of ['CS', 'DE', 'EN', 'KO']) {
		const control = I18N[language].SETTINGS.optional.controls.omissionMarker;
		assert.ok(control.name, language);
		assert.ok(control.description, language);
		assert.ok(control.options.none, language);
		assert.ok(control.options.ellipsis, language);
	}
});

test('omission marker defaults safely and persists across reloads', async () => {
	let storedSettings = {
		biblesPath: 'Bibles',
		defaultVersionShorthand: 'WEB',
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

	const LocalBibleRefPlugin = loadModule(
		'main.ts',
		createObsidianRuntime({ Plugin })
	);
	const existingUserPlugin = new LocalBibleRefPlugin();
	await existingUserPlugin.loadSettings();
	assert.equal(existingUserPlugin.settings.omissionMarker, 'none');

	existingUserPlugin.settings.omissionMarker = 'ellipsis';
	await existingUserPlugin.saveSettings();

	const reloadedPlugin = new LocalBibleRefPlugin();
	await reloadedPlugin.loadSettings();
	assert.equal(reloadedPlugin.settings.omissionMarker, 'ellipsis');
});

test('ellipsis markers preserve each output format', async (t) => {
	const expectedByFormat = {
		manuscript: 'In the beginning. … God said, “Let there be light.”\n\n',
		paragraph:
			'<sup>1</sup> In the beginning. … <sup>3</sup> God said, “Let there be light.”\n\n',
		quote:
			'> <sup>1</sup> In the beginning. … <sup>3</sup> God said, “Let there be light.”\n\n',
		callout:
			'> [!quote] Genesis 1:1,3 - WEB\n> <sup>1</sup> In the beginning. … <sup>3</sup> God said, “Let there be light.”\n\n',
	};

	for (const [format, expected] of Object.entries(expectedByFormat)) {
		await t.test(format, async () => {
			const passageSuggest = createPassageSuggest(
				genesisOne,
				format,
				'ellipsis'
			);
			const suggestions = await passageSuggest.getSuggestions({
				query: '--gen1:1,3',
			});

			assert.equal(suggestions[0].text, expected);
		});
	}
});

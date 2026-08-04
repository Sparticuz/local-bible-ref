/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function loadModule(entryPoint, obsidian = {}) {
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
	return bundledModule.exports.default;
}

function createPassageSuggest(chapterText, format = 'paragraph') {
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

test('a missing selected verse rejects the complete reference', async () => {
	const passageSuggest = createPassageSuggest(genesisOne);

	const suggestions = await passageSuggest.getSuggestions({
		query: '--gen1:1,999',
	});

	assert.equal(suggestions.length, 0);
});

test('malformed and cross-chapter selections are rejected', () => {
	const PassageReference = loadModule('src/passage-reference.ts');
	const invalidReferences = ['--gen1:1,', '--gen1:1,,3', '--gen1:1,2:3'];

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

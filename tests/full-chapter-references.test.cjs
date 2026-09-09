/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function loadPassageSuggest() {
	const result = buildSync({
		entryPoints: ['src/passage-suggest.ts'],
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
			if (id === 'obsidian') {
				return {
					EditorSuggest: class {
						constructor(app) {
							this.app = app;
						}
					},
					getLanguage: () => 'en',
					normalizePath: (path) => path,
					Notice: class {},
					TFolder: class {},
				};
			}
			return require(id);
		},
	});
	return bundledModule.exports.default;
}

const PassageSuggest = loadPassageSuggest();
const twoVerses = '<sup>1</sup> First verse.\n<sup>2</sup> Last verse.';

function makeSuggest({
	chapterText = twoVerses,
	format = 'quote',
	linkToPassage = true,
	bibleFormat = 'localBibleRef',
} = {}) {
	return new PassageSuggest(
		{
			vault: {
				getFolderByPath: () => null,
				getFileByPath: (path) => ({ path }),
				cachedRead: async () => chapterText,
			},
			fileManager: {
				generateMarkdownLink(file, sourcePath, subpath, alias) {
					assert.equal(sourcePath, 'Notes/Test.md');
					assert.equal(
						subpath,
						bibleFormat === 'bibleLinker' ? '#1' : undefined
					);
					return `[[${file.path}|${alias}]]`;
				},
			},
		},
		{
			biblesPath: 'Bibles',
			defaultVersionShorthand: 'ESV',
			defaultPassageFormat: format,
			bibleFormat,
			fullPreview: false,
			quote: {
				includeReference: true,
				referencePosition: 'end',
				linkToPassage,
			},
			callout: { type: 'quote', linkToPassage, collapsible: false },
		}
	);
}

async function getSuggestionText(query, options) {
	const suggestions = await makeSuggest(options).getSuggestions({
		query,
		file: { path: 'Notes/Test.md' },
	});
	assert.equal(suggestions.length, 1);
	return suggestions[0].text;
}

test('a complete explicit range uses a chapter-only linked reference', async () => {
	assert.equal(
		await getSuggestionText('--John 1:1-2'),
		'> <sup>1</sup> First verse.\n> <sup>2</sup> Last verse.\n' +
			'> [[Bibles/ESV/John/John 1.md|John 1 - ESV]]\n\n'
	);
});

test('partial ranges and nonexistent endpoints keep their verse labels', async () => {
	const cases = [
		[
			'--John 1:1-2',
			`${twoVerses}\n<sup>3</sup> Third verse.`,
			'John 1:1-2 - ESV',
		],
		['--John 1:2', twoVerses, 'John 1:2 - ESV'],
		['--John 1:1-999', twoVerses, 'John 1:1-999 - ESV'],
		['--John 1:1-2:2', twoVerses, 'John 1:1-2:2 - ESV'],
	];
	for (const [query, chapterText, label] of cases) {
		const text = await getSuggestionText(query, {
			chapterText,
			linkToPassage: false,
		});
		assert.ok(text.endsWith(`\n> ${label}\n\n`), query);
	}
});

test('paragraph output is unchanged when its full range is detected', async () => {
	assert.equal(
		await getSuggestionText('--John 1:1-2', { format: 'paragraph' }),
		`${twoVerses}\n\n`
	);
});

test('plain quote and callout references collapse full ranges', async () => {
	assert.equal(
		await getSuggestionText('--John 1:1-2', { linkToPassage: false }),
		'> <sup>1</sup> First verse.\n> <sup>2</sup> Last verse.\n> John 1 - ESV\n\n'
	);
	for (const linkToPassage of [false, true]) {
		const text = await getSuggestionText('--John 1:1-2', {
			format: 'callout',
			linkToPassage,
		});
		const label = linkToPassage
			? '[[Bibles/ESV/John/John 1.md|John 1 - ESV]]'
			: 'John 1 - ESV';
		assert.ok(text.startsWith(`> [!quote] ${label}\n`));
	}
});

test('Bible Linker full ranges retain their verse anchor with a chapter label', async () => {
	const text = await getSuggestionText('--John 1:1-2', {
		bibleFormat: 'bibleLinker',
		chapterText: '## v1\nFirst verse.\n\n## v2\nLast verse.',
	});
	assert.ok(text.endsWith('> [[Bibles/ESV/John/John 1.md|John 1 - ESV]]\n\n'));
});

test('footnote removal separates sentences without regressing upstream reference matching', async () => {
	assert.equal(
		await getSuggestionText('--John 1:1', {
			format: 'paragraph',
			chapterText:
				'<sup>1</sup> First.[^long-note-name]Next sentence.\n<sup>2</sup> Last verse.',
		}),
		'<sup>1</sup> First. Next sentence.\n\n'
	);
	assert.equal(
		makeSuggest().removeFootnoteRefs('Word[^a-b] next.\n[^a-b]: Definition.'),
		'Word next.\n[^a-b]: Definition.'
	);
});

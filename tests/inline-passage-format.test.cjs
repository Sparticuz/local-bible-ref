/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('assert');
const vm = require('vm');
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

	const passageSuggestModule = { exports: {} };
	const context = {
		module: passageSuggestModule,
		exports: passageSuggestModule.exports,
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
	};

	vm.runInNewContext(result.outputFiles[0].text, context);
	return passageSuggestModule.exports.default;
}

const PassageSuggest = loadPassageSuggest();

function makeSuggest({
	defaultPassageFormat = 'paragraph',
	bibleFormat = 'localBibleRef',
	chapterTexts = {
		1: '<sup>16</sup> For God so loved the world.\n<sup>17</sup> For God did not send the Son!',
	},
} = {}) {
	const settings = {
		biblesPath: 'Bibles',
		defaultVersionShorthand: 'ESV',
		defaultPassageFormat,
		bibleFormat,
		fullPreview: false,
		quote: {
			includeReference: true,
			referencePosition: 'end',
			linkToPassage: true,
		},
		callout: { type: 'quote', linkToPassage: true, collapsible: true },
	};
	const app = {
		vault: {
			getFolderByPath: () => null,
			getFileByPath(path) {
				const match = path.match(/John (\d+)\.md$/);
				return match ? { path, chapter: Number(match[1]) } : null;
			},
			async cachedRead(file) {
				return chapterTexts[file.chapter];
			},
		},
		fileManager: {
			generateMarkdownLink(file, sourcePath, subpath, alias) {
				assert.strictEqual(sourcePath, 'Notes/Test.md');
				assert.strictEqual(
					subpath,
					bibleFormat === 'bibleLinker' ? '#16' : undefined
				);
				return `[[${file.path}|${alias}]]`;
			},
		},
	};

	return new PassageSuggest(app, settings);
}

function suggestionContext(query) {
	return { query, file: { path: 'Notes/Test.md' } };
}

async function getSuggestionText(query, options) {
	const suggestions = await makeSuggest(options).getSuggestions(
		suggestionContext(query)
	);
	assert.strictEqual(suggestions.length, 1);
	return suggestions[0].text;
}

(async () => {
	assert.strictEqual(
		await getSuggestionText('--John 1:16-17+inline'),
		'"<sup>16</sup> For God so loved the world. <sup>17</sup> For God did not send the Son!" ([[Bibles/ESV/John/John 1.md|John 1:16-17 - ESV]])'
	);
	assert.strictEqual(
		await getSuggestionText('--John 1:16+i'),
		'"<sup>16</sup> For God so loved the world." ([[Bibles/ESV/John/John 1.md|John 1:16 - ESV]])'
	);
	assert.strictEqual(
		await getSuggestionText('Paul writes, --John 1:16+esv'),
		'"<sup>16</sup> For God so loved the world." ([[Bibles/ESV/John/John 1.md|John 1:16 - ESV]])'
	);
	assert.strictEqual(
		await getSuggestionText('    --John 1:16'),
		'<sup>16</sup> For God so loved the world.\n\n'
	);
	assert.strictEqual(
		await getSuggestionText('- --John 1:16'),
		'"<sup>16</sup> For God so loved the world." ([[Bibles/ESV/John/John 1.md|John 1:16 - ESV]])'
	);
	assert.match(await getSuggestionText('Text --John 1:16+quote'), /^> /);
	assert.strictEqual(
		await getSuggestionText('--John 1:16', {
			defaultPassageFormat: 'inline',
		}),
		'"<sup>16</sup> For God so loved the world." ([[Bibles/ESV/John/John 1.md|John 1:16 - ESV]])'
	);
	assert.strictEqual(
		await getSuggestionText('In summary, --John 1+esv', {
			chapterTexts: {
				1: '<sup>1</sup> He said, "Come and see."\n<sup>2</sup> They came.',
			},
		}),
		'"<sup>1</sup> He said, "Come and see." <sup>2</sup> They came." ([[Bibles/ESV/John/John 1.md|John 1 - ESV]])'
	);

	const trigger = makeSuggest().onTrigger(
		{ line: 0, ch: 25 },
		{ getLine: () => 'Paul writes, --John 1:16' },
		null
	);
	assert.deepStrictEqual(
		JSON.parse(JSON.stringify(trigger)),
		{
			end: { line: 0, ch: 25 },
			query: 'Paul writes, --John 1:16',
			start: { ch: 13, line: 0 },
		}
	);

	assert.strictEqual(
		await getSuggestionText('--John 1:16-2:1+inline', {
			chapterTexts: {
				1: '<sup>16</sup> End of chapter.',
				2: '<sup>1</sup> Start of chapter?',
			},
		}),
		'"<sup>16</sup> End of chapter. <sup>1</sup> Start of chapter?" ([[Bibles/ESV/John/John 1.md|John 1:16-2:1 - ESV]])'
	);
	assert.strictEqual(
		await getSuggestionText('Summary: --John 1-2', {
			chapterTexts: {
				1: '<sup>1</sup> First chapter.',
				2: '<sup>1</sup> Second chapter.',
			},
		}),
		'"<sup>1</sup> First chapter. <sup>1</sup> Second chapter." ([[Bibles/ESV/John/John 1.md|John 1-2 - ESV]])'
	);
	assert.strictEqual(
		await getSuggestionText('--John 1:16+inline', {
			bibleFormat: 'bibleLinker',
			chapterTexts: {
				1: '## v16\nFor God so loved the world.',
			},
		}),
		'"<sup>16</sup> For God so loved the world." ([[Bibles/ESV/John/John 1.md|John 1:16 - ESV]])'
	);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

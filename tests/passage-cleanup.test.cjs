/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('assert');
const vm = require('vm');
const { buildSync } = require('esbuild');

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

const PassageSuggest = passageSuggestModule.exports.default;
const removeFootnoteRefs = PassageSuggest.prototype.removeFootnoteRefs;

assert.strictEqual(
	removeFootnoteRefs('[^intro] In the beginning[^1], God created [^long-note].'),
	' In the beginning, God created.'
);
assert.strictEqual(
	removeFootnoteRefs('Text [^note-id] and [^x y] and [^1234567890] done'),
	'Text and and done'
);
assert.strictEqual(
	removeFootnoteRefs('Verse text [^1] next word'),
	'Verse text next word'
);
assert.strictEqual(
	removeFootnoteRefs('One sentence.[^psa46]Next sentence.'),
	'One sentence. Next sentence.'
);
assert.strictEqual(
	removeFootnoteRefs('Keep [^one\nline] intact'),
	'Keep [^one\nline] intact'
);
assert.strictEqual(
	removeFootnoteRefs('[^1]: footnote definition\nVerse text [^1]'),
	'[^1]: footnote definition\nVerse text'
);

(async () => {
	for (const bibleFormat of ['localBibleRef', 'bibleLinker']) {
		const suggest = new PassageSuggest(
			{
				vault: {
					getFolderByPath: () => null,
					getFileByPath: (path) => ({ path }),
					cachedRead: async () =>
						bibleFormat === 'bibleLinker'
							? '## v1\nFirst.\n## v3\nThird.\n## v5\nFifth.'
							: '<sup>1</sup> First.\n<sup>3</sup> Third.\n<sup>5</sup> Fifth.',
				},
			},
			{
				biblesPath: 'Bibles',
				defaultVersionShorthand: 'WEB',
				defaultPassageFormat: 'paragraph',
				bibleFormat,
			}
		);
		for (const [query, expected] of [
			['--gen1:1', ['1']],
			['--gen1:1-3', ['1', '3']],
		]) {
			const suggestions = await suggest.getSuggestions({ query });
			assert.deepStrictEqual(
				Array.from(suggestions[0].text.matchAll(/<sup>(\d+)<\/sup>/g), (match) => match[1]),
				expected
			);
			assert.ok(suggestions[0].text.includes('First.'));
			assert.ok(!suggestions[0].text.includes('Fifth.'));
		}
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

import { getLanguage } from 'obsidian';
import { I18N } from './i18n';
import { Book } from './i18n/models';

export default class PassageReference
	implements ChapterReference, PassageOptions
{
	startChapter: number;
	startVerse: number;
	endChapter: number;
	endVerse: number;
	verseSegments: VerseSegment[];
	book: Book;
	version: string;
	format: PassageFormat;

	constructor(
		chapterRef: ChapterReference,
		book: Book,
		passageOptions: PassageOptions
	) {
		this.startChapter = chapterRef.startChapter;
		this.startVerse = chapterRef.startVerse;
		this.endChapter = chapterRef.endChapter;
		this.endVerse = chapterRef.endVerse;
		this.verseSegments = chapterRef.verseSegments ?? [];
		if (
			this.verseSegments.length === 0 &&
			this.startChapter === this.endChapter &&
			this.endVerse !== -1
		) {
			this.verseSegments = [
				{ startVerse: this.startVerse, endVerse: this.endVerse },
			];
		}
		this.book = book;
		this.version = passageOptions.version;
		this.format = passageOptions.format;
	}

	/** Parses a passage reference from the given text. */
	static parse(
		text: string,
		defaultVersionShorthand: string,
		defaultPassageFormat: PassageFormat
	): PassageReference | null {
		const match = text.match(this.regExp);
		if (!match) return null;

		let chapterRef = this.parseVerseSelection(match[2]);
		if (!chapterRef) chapterRef = this.parseMultiChapterRef(match[2]);
		if (!chapterRef) chapterRef = this.parseMultiChapterVerseRef(match[2]);
		if (!chapterRef) chapterRef = this.parseMultiVerseRef(match[2]);
		if (!chapterRef) return null;

		const book = this.getBook(match[1]);
		if (!book) return null;

		const precedingContent = text.slice(0, match.index).trim().length > 0;
		const inferredFormat = precedingContent
			? PassageFormat.Inline
			: defaultPassageFormat;
		const options = this.parseOptions(
			match[3],
			defaultVersionShorthand,
			inferredFormat
		);

		return new PassageReference(chapterRef, book, options);
	}

	/** Builds the passage matching regular expression. */
	static get regExp(): RegExp {
		const books = getBooksByLanguage();
		let regExpString = '\\-\\- ?(';
		regExpString += books
			.map((b) => `${b.name}|${b.aliases.join('|')}`)
			.join('|');
		const selectionItem = '\\d{1,3}(?: ?\\- ?\\d{1,3})?';
		regExpString +=
			') ?(\\d{1,3}(?::\\d{1,3})?(?: ?\\- ?\\d{1,3}(?::\\d{1,3})?)?|\\d{1,3}:' +
			selectionItem +
			'(?:, ?' +
			selectionItem +
			')+)((?: ?\\+\\w+(?::[a-z]+)?){0,2})$';

		return new RegExp(regExpString, 'i');
	}

	/** Stringifies the passage reference back into text. */
	stringify(): string {
		// multi-chapter ref
		if (this.startVerse === 1 && this.endVerse === -1) {
			if (this.startChapter === this.endChapter)
				return this.book.name + ` ${this.startChapter} - ${this.version}`;
			return (
				`${this.book.name} ${this.startChapter}-` +
				`${this.endChapter} - ${this.version}`
			);
		}

		// noncontiguous verse selection
		if (this.verseSegments.length > 1) {
			const selection = this.verseSegments
				.map(({ startVerse, endVerse }) =>
					startVerse === endVerse
						? `${startVerse}`
						: `${startVerse}-${endVerse}`
				)
				.join(',');
			return `${this.book.name} ${this.startChapter}:${selection} - ${this.version}`;
		}

		// multi-verse ref
		if (this.startChapter === this.endChapter) {
			if (this.startVerse === this.endVerse)
				return (
					this.book.name +
					` ${this.startChapter}:${this.startVerse} - ${this.version}`
				);
			return (
				`${this.book.name} ${this.startChapter}:` +
				`${this.startVerse}-${this.endVerse} - ${this.version}`
			);
		}

		// multi-chapter-and-verse ref
		const a = `${this.startChapter}:${this.startVerse}`;
		const b = `${this.endChapter}:${this.endVerse}`;
		return `${this.book.name} ${a}-${b} - ${this.version}`;
	}

	/** Stringifies this reference as a whole-chapter reference. */
	stringifyFullChapter(): string {
		return this.book.name + ` ${this.startChapter} - ${this.version}`;
	}

	/** Parses and normalizes a comma-separated verse selection in one chapter. */
	private static parseVerseSelection(text: string): ChapterReference | null {
		const match = text.match(/^(\d{1,3}):(.+,.+)$/);
		if (!match) return null;

		const verseSegments: VerseSegment[] = [];
		for (const item of match[2].split(',')) {
			const itemMatch = item.trim().match(/^(\d{1,3})(?: ?- ?(\d{1,3}))?$/);
			if (!itemMatch) return null;

			const startVerse = +itemMatch[1];
			const endVerse = itemMatch[2] ? +itemMatch[2] : startVerse;
			if (startVerse > endVerse) return null;
			verseSegments.push({ startVerse, endVerse });
		}

		verseSegments.sort((a, b) => a.startVerse - b.startVerse);
		const normalizedSegments: VerseSegment[] = [];
		for (const segment of verseSegments) {
			const previous = normalizedSegments[normalizedSegments.length - 1];
			if (previous && segment.startVerse <= previous.endVerse + 1) {
				previous.endVerse = Math.max(previous.endVerse, segment.endVerse);
			} else {
				normalizedSegments.push({ ...segment });
			}
		}

		return {
			startChapter: +match[1],
			startVerse: normalizedSegments[0].startVerse,
			endChapter: +match[1],
			endVerse: normalizedSegments[normalizedSegments.length - 1].endVerse,
			verseSegments: normalizedSegments,
		};
	}

	/**
	 * Parses a multi-chapter reference from the given text.
	 * Reference format: `startChapter[[ ]-[ ]endChapter]`.
	 */
	private static parseMultiChapterRef(text: string): ChapterReference | null {
		const regExp = /^(\d{1,3})(?: ?- ?(\d{1,3}))?$/i;
		const match = text.match(regExp);
		if (!match) return null;

		return {
			startChapter: +match[1],
			startVerse: 1,
			endChapter: match[2] ? +match[2] : +match[1],
			endVerse: -1,
		};
	}

	/**
	 * Parses a multi-chapter-and-verse reference from the given text.
	 * Reference format: `startChapter:startVerse[ ]-[ ]endChapter:endVerse`.
	 */
	private static parseMultiChapterVerseRef(
		text: string
	): ChapterReference | null {
		const regex = /^(\d{1,3}):(\d{1,3}) ?- ?(\d{1,3}):(\d{1,3})$/i;
		const match = text.match(regex);
		if (!match) return null;

		return {
			startChapter: +match[1],
			startVerse: +match[2],
			endChapter: +match[3],
			endVerse: +match[4],
		};
	}

	/**
	 * Parses a multi-verse reference from the given text.
	 * Reference format: `startChapter:startVerse[-endVerse]`.
	 */
	private static parseMultiVerseRef(text: string): ChapterReference | null {
		const regex = /^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/i;
		const match = text.match(regex);
		if (!match) return null;

		return {
			startChapter: +match[1],
			startVerse: +match[2],
			endChapter: +match[1],
			endVerse: match[3] ? +match[3] : +match[2],
		};
	}

	/** Retrieves a book based on its alias. */
	private static getBook(alias: string): Book | undefined {
		const books = getBooksByLanguage();
		alias = alias.toLowerCase();
		return books.find((book) => {
			const aliases = book.aliases.map((a) => a.toLowerCase());
			if (book.name.toLowerCase() === alias) return book;
			if (aliases.includes(alias)) return book;
		});
	}

	/** Parses passage options from the given text. */
	private static parseOptions(
		text: string,
		defaultVersionShorthand: string,
		defaultPassageFormat: PassageFormat
	): PassageOptions {
		const optionArgs = text
			.toLowerCase()
			.split('+')
			.filter(Boolean)
			.map((x) => x.trim());

		const options: PassageOptions = {
			version: defaultVersionShorthand,
			format: defaultPassageFormat,
		};

		// there are special keywords for formatting (m or manuscript, for
		// example) - anything else is treated as a Bible version code
		for (const option of optionArgs) {
			switch (option) {
				case 'm':
				case 'manuscript':
					options.format = PassageFormat.Manuscript;
					break;
				case 'p':
				case 'paragraph':
					options.format = PassageFormat.Paragraph;
					break;
				case 'q':
				case 'quote':
					options.format = PassageFormat.Quote;
					break;
				case 'c':
				case 'callout':
					options.format = PassageFormat.Callout;
					break;
				case 'i':
				case 'inline':
					options.format = PassageFormat.Inline;
					break;
				default:
					options.version = option.toUpperCase();
					break;
			}
		}

		return options;
	}
}

function getBooksByLanguage(): Book[] {
	switch (getLanguage()) {
		case 'cs':
			return I18N.CS.BOOKS;
		case 'de':
			return I18N.DE.BOOKS;
		case 'ko':
			return I18N.KO.BOOKS;
		case 'en':
		default:
			return I18N.EN.BOOKS;
	}
}

export enum PassageFormat {
	Manuscript = 'manuscript',
	Paragraph = 'paragraph',
	Quote = 'quote',
	Callout = 'callout',
	Inline = 'inline',
}

export interface VerseSegment {
	startVerse: number;
	endVerse: number;
}

interface ChapterReference {
	startChapter: number;
	startVerse: number;
	endChapter: number;
	endVerse: number;
	verseSegments?: VerseSegment[];
}

interface PassageOptions {
	version: string;
	format: PassageFormat;
}
